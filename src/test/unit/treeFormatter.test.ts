/*
 * treeFormatter.test.ts — unit tests for the pure box-drawing tree renderer
 * (M3/WU-1: F3.1).
 *
 * Pure-function tests over a crafted tree mirroring the real sample shape (Layer
 * full-canvas mark 1; CameraActor zero-box mark 2; FlexLayoutImpl full-canvas
 * mark 3; LabelImpl {381,262,262,56} mark 4): no docker, no fs. Asserts the
 * output is a box-drawing hierarchy, one line per node, with the per-line
 * `Type "name" #mark  [id]  (WxH @ x,y)` shape and correct nesting.
 */

import { expect } from 'chai';
import { MinimalNode } from '../../treeModel';
import { formatTree } from '../../formatters/treeFormatter';

const W = 1024;
const H = 600;

/** Crafted tree mirroring the real canonical shape, marks pre-assigned in pre-order. */
function fixtureTree(): MinimalNode {
    return {
        id: '0',
        type: 'Layer',
        role: 'panel',
        name: 'RootLayer',
        mark: 1,
        bounds: { x: 0, y: 0, w: W, h: H },
        children: [
            { id: '0/0', type: 'CameraActor', mark: 2, name: '', bounds: { x: 0, y: 0, w: 0, h: 0 } },
            {
                id: '0/1',
                type: 'FlexLayoutImpl',
                role: 'container',
                name: '',
                mark: 3,
                bounds: { x: 0, y: 0, w: W, h: H },
                children: [
                    {
                        id: '0/1/0',
                        type: 'LabelImpl',
                        role: 'label',
                        name: 'Hello',
                        mark: 4,
                        bounds: { x: 381, y: 262, w: 262, h: 56 },
                    },
                ],
            },
        ],
    };
}

/** Box-drawing glyphs the formatter uses for connectors/rails. */
const BOX_CHARS = ['┠', '┖', '┃', '╴'];

describe('treeFormatter.formatTree', () => {
    it('emits one line per node (root + 3 descendants = 4 lines)', () => {
        const lines = formatTree(fixtureTree()).split('\n');
        expect(lines).to.have.lengthOf(4);
    });

    it('contains a box-drawing character', () => {
        const out = formatTree(fixtureTree());
        expect(BOX_CHARS.some((c) => out.includes(c))).to.equal(true);
    });

    it('renders the per-node line as `Type "name" #mark  [id]  (WxH @ x,y)`', () => {
        const out = formatTree(fixtureTree());
        // Root line (no connector prefix).
        expect(out).to.include('Layer "RootLayer" #1  [0]  (1024x600 @ 0,0)');
        // The label line carries its own type, name, mark, id and bounds.
        expect(out).to.include('LabelImpl "Hello" #4  [0/1/0]  (262x56 @ 381,262)');
    });

    it('includes the WU-1 assertion tokens (LabelImpl and #4)', () => {
        const out = formatTree(fixtureTree());
        expect(out).to.include('LabelImpl');
        expect(out).to.include('#4');
    });

    it('prefixes non-last children with ┠╴ and the last child with ┖╴', () => {
        const lines = formatTree(fixtureTree()).split('\n');
        // children of root: CameraActor (non-last) then FlexLayoutImpl (last).
        const camera = lines.find((l) => l.includes('CameraActor')) as string;
        const flex = lines.find((l) => l.includes('FlexLayoutImpl')) as string;
        expect(camera.startsWith('┠╴')).to.equal(true);
        expect(flex.startsWith('┖╴')).to.equal(true);
    });

    it('indents a grandchild deeper than its parent', () => {
        const lines = formatTree(fixtureTree()).split('\n');
        const flex = lines.find((l) => l.includes('FlexLayoutImpl')) as string;
        const label = lines.find((l) => l.includes('LabelImpl')) as string;
        // The label sits under the LAST child (Flex), so its rail prefix is blank
        // padding before its own ┖╴ connector — strictly more leading whitespace
        // than the Flex line's own connector start.
        const flexIndent = flex.search(/┖╴|┠╴/);
        const labelIndent = label.search(/┖╴|┠╴/);
        expect(labelIndent).to.be.greaterThan(flexIndent);
    });

    it('renders an empty name as the empty quoted string', () => {
        const out = formatTree(fixtureTree());
        expect(out).to.include('FlexLayoutImpl "" #3');
    });

    it('is deterministic — identical output for identical input', () => {
        expect(formatTree(fixtureTree())).to.equal(formatTree(fixtureTree()));
    });

    it('marks a node carrying truncated:true with a …truncated suffix', () => {
        const root = fixtureTree();
        (root.children as MinimalNode[])[1].truncated = true;
        const out = formatTree(root);
        const flex = out.split('\n').find((l) => l.includes('FlexLayoutImpl')) as string;
        expect(flex).to.include('…truncated');
    });

    it('falls back to (no bounds) for a node without numeric bounds', () => {
        const root: MinimalNode = { id: '0', type: 'Layer', mark: 1 };
        const out = formatTree(root);
        expect(out).to.include('(no bounds)');
    });
});
