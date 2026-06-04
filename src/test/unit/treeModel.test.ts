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

            // FlexLayout::New() is on line 0; both labels on line 1 (0-based).
            expect(flex.sourceLine).to.equal(0);
            expect(labels[0].sourceLine).to.equal(1);
            expect(labels[1].sourceLine).to.equal(1);

            // CameraActor siblings must NOT receive a sourceLine.
            const cameras = (root.children as MinimalNode[]).filter(
                (c) => c.type === 'CameraActor',
            );
            expect(cameras).to.have.lengthOf(2);
            for (const cam of cameras) {
                expect(cam.sourceLine).to.be.undefined;
            }
        });

        it('honours opts.startLine when merging sourceLine', () => {
            const root = buildTree(fixtureMetadata(), { sourceCode, startLine: 10 });
            const flex = (root.children as MinimalNode[])[1];
            const labels = flex.children as MinimalNode[];
            expect(flex.sourceLine).to.equal(10);
            expect(labels[0].sourceLine).to.equal(11);
            expect(labels[1].sourceLine).to.equal(11);
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
});
