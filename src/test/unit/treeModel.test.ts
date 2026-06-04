/*
 * treeModel.test.ts — unit tests for buildTree (M1/WU-4).
 *
 * Pure-function tests over crafted harness metadata JSON fixtures: no docker,
 * no network, no real rendering. Covers input validation, root-type stamping,
 * semanticsSource normalization, and sourceLine merge (with cameras skipped).
 */

import { expect } from 'chai';
import { buildTree, MinimalNode } from '../../treeModel';
import { clearParserCache } from '../../cppParser';

/**
 * Fixture per WU-4: a Layer root with two internal CameraActor siblings wrapping
 * a FlexLayoutImpl whose two LabelImpl children all carry the legacy harness
 * `semanticsSource:"accessible"` value (must normalize to `"bridge"`).
 */
function fixtureMetadata(): string {
    return JSON.stringify({
        root: {
            type: 'Layer',
            children: [
                { type: 'CameraActor', name: 'DefaultCamera' },
                {
                    type: 'FlexLayoutImpl',
                    semanticsSource: 'accessible',
                    children: [
                        { type: 'LabelImpl', semanticsSource: 'accessible' },
                        { type: 'LabelImpl', semanticsSource: 'accessible' },
                    ],
                },
                { type: 'CameraActor', name: 'OffscreenCamera' },
            ],
        },
    });
}

/** Collect every `semanticsSource` value found anywhere in the tree. */
function collectSemanticsSources(node: MinimalNode, out: unknown[] = []): unknown[] {
    if (node.semanticsSource !== undefined) {
        out.push(node.semanticsSource);
    }
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            if (child !== null && typeof child === 'object') {
                collectSemanticsSources(child as MinimalNode, out);
            }
        }
    }
    return out;
}

/** Collect every node's `mark` in pre-order (parent before children). */
function collectMarks(node: MinimalNode, out: unknown[] = []): unknown[] {
    out.push(node.mark);
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            if (child !== null && typeof child === 'object') {
                collectMarks(child as MinimalNode, out);
            }
        }
    }
    return out;
}

describe('treeModel.buildTree', () => {
    // The parser caches by code string; reset so sourceLine tests are isolated.
    beforeEach(() => clearParserCache());

    describe('input validation', () => {
        it('throws on null metadata', () => {
            expect(() => buildTree(null)).to.throw('no scene metadata was produced by the render.');
        });

        it('throws on empty / whitespace-only metadata', () => {
            expect(() => buildTree('')).to.throw('no scene metadata was produced by the render.');
            expect(() => buildTree('   \n\t ')).to.throw(
                'no scene metadata was produced by the render.',
            );
        });

        it('throws on invalid JSON', () => {
            expect(() => buildTree('{ not valid json')).to.throw(
                'scene metadata is not valid JSON:',
            );
        });

        it('throws on JSON with no object root', () => {
            // A bare JSON scalar parses fine but is not an object root node.
            expect(() => buildTree('42')).to.throw('scene metadata has no object root node.');
            expect(() => buildTree('"a string"')).to.throw(
                'scene metadata has no object root node.',
            );
            expect(() => buildTree('null')).to.throw(
                'scene metadata has no object root node.',
            );
        });
    });

    describe('semanticsSource normalization (F1.1)', () => {
        it('returns the root with its concrete type', () => {
            const root = buildTree(fixtureMetadata());
            expect(root).to.be.an('object');
            expect(root.type).to.equal('Layer');
        });

        it('normalizes "accessible" to "bridge" everywhere in the tree', () => {
            const root = buildTree(fixtureMetadata());
            const sources = collectSemanticsSources(root);

            // Three nodes carried semanticsSource (the Flex + two Labels).
            expect(sources).to.have.lengthOf(3);
            expect(sources).to.deep.equal(['bridge', 'bridge', 'bridge']);
            expect(sources).to.not.include('accessible');
        });

        it('leaves "reconstructed" and absent values untouched', () => {
            const json = JSON.stringify({
                root: {
                    type: 'Layer',
                    children: [
                        { type: 'FlexLayoutImpl', semanticsSource: 'reconstructed' },
                        { type: 'LabelImpl' }, // no semanticsSource at all
                    ],
                },
            });
            const root = buildTree(json);
            const flex = (root.children as MinimalNode[])[0];
            const label = (root.children as MinimalNode[])[1];
            expect(flex.semanticsSource).to.equal('reconstructed');
            expect(label.semanticsSource).to.be.undefined;
        });
    });

    describe('root-type stamping (F0.4)', () => {
        it('stamps type:"Layer" on a root missing a type', () => {
            const json = JSON.stringify({ root: { name: 'RootLayer', children: [] } });
            const root = buildTree(json);
            expect(root.type).to.equal('Layer');
        });

        it('stamps type:"Layer" on a root with an empty-string type', () => {
            const json = JSON.stringify({ root: { type: '', children: [] } });
            const root = buildTree(json);
            expect(root.type).to.equal('Layer');
        });

        it('accepts a bare node (no { root } wrapper)', () => {
            const json = JSON.stringify({ type: 'Layer', children: [] });
            const root = buildTree(json);
            expect(root.type).to.equal('Layer');
        });
    });

    describe('sourceLine merge (F1.5)', () => {
        const sourceCode = 'return FlexLayout::New()\n  .Children({ Label::New("A"), Label::New("B") });';

        it('injects numeric sourceLine into the runtime user-subtree, skipping cameras', () => {
            const root = buildTree(fixtureMetadata(), { sourceCode });

            // The user root is the first non-CameraActor child (the FlexLayoutImpl).
            const flex = (root.children as MinimalNode[])[1];
            expect(flex.type).to.equal('FlexLayoutImpl');
            expect(flex.sourceLine).to.be.a('number');

            const labels = flex.children as MinimalNode[];
            expect(labels[0].type).to.equal('LabelImpl');
            expect(labels[1].type).to.equal('LabelImpl');
            expect(labels[0].sourceLine).to.be.a('number');
            expect(labels[1].sourceLine).to.be.a('number');

            // sourceLine is 1-based at the output boundary (F1.5): FlexLayout::New()
            // is on file line 1; both labels on file line 2.
            expect(flex.sourceLine).to.equal(1);
            expect(labels[0].sourceLine).to.equal(2);
            expect(labels[1].sourceLine).to.equal(2);

            // CameraActor siblings must NOT receive a sourceLine.
            const cameras = (root.children as MinimalNode[]).filter(
                (c) => c.type === 'CameraActor',
            );
            expect(cameras).to.have.lengthOf(2);
            for (const cam of cameras) {
                expect(cam.sourceLine).to.be.undefined;
            }
        });

        it('honours opts.startLine when merging sourceLine (1-based result)', () => {
            // startLine is the 0-based file offset; the emitted sourceLine is 1-based,
            // so FlexLayout (parser line 0) → 0+10+1 = 11, labels (parser line 1) → 12.
            const root = buildTree(fixtureMetadata(), { sourceCode, startLine: 10 });
            const flex = (root.children as MinimalNode[])[1];
            const labels = flex.children as MinimalNode[];
            expect(flex.sourceLine).to.equal(11);
            expect(labels[0].sourceLine).to.equal(12);
            expect(labels[1].sourceLine).to.equal(12);
        });

        it('reports 1-based file lines for the canonical preview-file sample', () => {
            // Regression for the off-by-one (0-based) sourceLine bug: with the real
            // hello-dali sample (preview-file mode → startLine 0), the FlexLayout is
            // on file line 13, "Hello, Dali!" on 21, the second label on 25. The
            // emitted sourceLine MUST equal those 1-based file lines.
            const sampleCode = [
                '// hello-dali.preview.dali.cpp',          // 1
                '//',                                       // 2
                '// Welcome to DALi Preview!',              // 3
                '//',                                       // 4
                '// line 5',                                // 5
                '// line 6',                                // 6
                '// line 7',                                // 7
                '// line 8',                                // 8
                '// line 9',                                // 9
                '// line 10',                               // 10
                '// line 11',                               // 11
                '',                                         // 12
                'return FlexLayout::New()',                 // 13
                '    .SetDirection(FlexDirection::COLUMN)',  // 14
                '    .SetAlignItems(FlexAlign::CENTER)',     // 15
                '    .SetJustifyContent(FlexJustify::CENTER)', // 16
                '    .SetRequestedWidth(MATCH_PARENT)',      // 17
                '    .SetRequestedHeight(MATCH_PARENT)',     // 18
                '    .SetBackgroundColor(UiColor(0x1e1e2e))', // 19
                '    .Children({',                           // 20
                '        Label::New("Hello, Dali!")',        // 21
                '            .SetFontSize(48)',              // 22
                '            .SetTextColor(UiColor(0xFFFFFF)),', // 23
                '',                                         // 24
                '        Label::New("Edit this file to see the preview update")', // 25
                '            .SetFontSize(18)',              // 26
                '            .SetTextColor(UiColor(0x888899)),', // 27
                '    });',                                   // 28
            ].join('\n');

            const root = buildTree(fixtureMetadata(), { sourceCode: sampleCode });
            const flex = (root.children as MinimalNode[])[1];
            const labels = flex.children as MinimalNode[];

            expect(flex.sourceLine).to.equal(13);
            expect(labels[0].sourceLine).to.equal(21);
            expect(labels[1].sourceLine).to.equal(25);
        });

        it('adds no sourceLine and does not throw when sourceCode is omitted', () => {
            const root = buildTree(fixtureMetadata());
            const flex = (root.children as MinimalNode[])[1];
            const labels = flex.children as MinimalNode[];
            expect(flex.sourceLine).to.be.undefined;
            expect(labels[0].sourceLine).to.be.undefined;
            expect(labels[1].sourceLine).to.be.undefined;
        });

        it('does not throw when sourceCode is unparseable (parser returns null)', () => {
            // `if (...)` contains a fail keyword → parseChainExpression returns null.
            const root = buildTree(fixtureMetadata(), { sourceCode: 'if (x) return Foo::New();' });
            const flex = (root.children as MinimalNode[])[1];
            expect(flex.sourceLine).to.be.undefined;
        });
    });

    describe('mark assignment (M2/F2.2)', () => {
        it('stamps an integer mark on every node, root first', () => {
            const root = buildTree(fixtureMetadata());
            const marks = collectMarks(root);
            expect(marks).to.have.lengthOf(6);
            for (const m of marks) {
                expect(m).to.be.a('number');
                expect(Number.isInteger(m as number)).to.equal(true);
            }
            expect(root.mark).to.equal(1);
        });

        it('assigns the contiguous set 1..N with no gaps or duplicates', () => {
            const root = buildTree(fixtureMetadata());
            const marks = collectMarks(root) as number[];
            const sorted = [...marks].sort((a, b) => a - b);
            const expected = Array.from({ length: marks.length }, (_, i) => i + 1);
            expect(sorted).to.deep.equal(expected);
            expect(new Set(marks).size).to.equal(marks.length);
        });

        it('follows pre-order on the known fixture shape', () => {
            // Layer > [CameraActor, FlexLayoutImpl > [Label, Label], CameraActor].
            const root = buildTree(fixtureMetadata());
            expect(root.type).to.equal('Layer');
            expect(root.mark).to.equal(1);

            const children = root.children as MinimalNode[];
            const firstCamera = children[0];
            const flex = children[1];
            const lastCamera = children[2];
            const labels = flex.children as MinimalNode[];

            expect(firstCamera.type).to.equal('CameraActor');
            expect(firstCamera.mark).to.equal(2);
            expect(flex.type).to.equal('FlexLayoutImpl');
            expect(flex.mark).to.equal(3);
            expect(labels[0].type).to.equal('LabelImpl');
            expect(labels[0].mark).to.equal(4);
            expect(labels[1].type).to.equal('LabelImpl');
            expect(labels[1].mark).to.equal(5);
            expect(lastCamera.type).to.equal('CameraActor');
            expect(lastCamera.mark).to.equal(6);
        });

        it('marks CameraActor nodes too (uniform, no gaps)', () => {
            const root = buildTree(fixtureMetadata());
            const cameras = (root.children as MinimalNode[]).filter(
                (c) => c.type === 'CameraActor',
            );
            expect(cameras).to.have.lengthOf(2);
            for (const cam of cameras) {
                expect(cam.mark).to.be.a('number');
            }
        });

        it('is deterministic: a second buildTree yields the identical marks', () => {
            const a = collectMarks(buildTree(fixtureMetadata()));
            const b = collectMarks(buildTree(fixtureMetadata()));
            expect(a).to.deep.equal(b);
        });
    });
});
