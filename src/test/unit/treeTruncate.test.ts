/*
 * treeTruncate.test.ts — unit tests for the pure token-bounded pruner
 * (M3/WU-3: F3.3).
 *
 * Pure-function tests over a crafted tree mirroring the real sample shape (Layer
 * mark 1 → [CameraActor mark 2, FlexLayoutImpl mark 3 → [LabelImpl mark 4]]): no
 * docker, no fs. Asserts maxDepth / maxNodes bound the clone, a pruned parent is
 * stamped `truncated: true`, the input is never mutated, and the output is
 * deterministic.
 */

import { expect } from 'chai';
import { MinimalNode } from '../../treeModel';
import { truncate } from '../../treeTruncate';

const W = 1024;
const H = 600;

/** Crafted 4-node tree; marks pre-assigned in pre-order, matching the real shape. */
function fixtureTree(): MinimalNode {
    return {
        id: '0',
        type: 'Layer',
        mark: 1,
        bounds: { x: 0, y: 0, w: W, h: H },
        children: [
            { id: '0/0', type: 'CameraActor', mark: 2, bounds: { x: 0, y: 0, w: 0, h: 0 } },
            {
                id: '0/1',
                type: 'FlexLayoutImpl',
                mark: 3,
                bounds: { x: 0, y: 0, w: W, h: H },
                children: [
                    {
                        id: '0/1/0',
                        type: 'LabelImpl',
                        mark: 4,
                        bounds: { x: 381, y: 262, w: 262, h: 56 },
                    },
                ],
            },
        ],
    };
}

/** Count every node in a tree (pre-order). */
function countNodes(node: MinimalNode): number {
    const kids = Array.isArray(node.children) ? node.children : [];
    return 1 + kids.reduce((sum, k) => sum + countNodes(k), 0);
}

/** Collect the marks of every node carrying `truncated: true`. */
function truncatedMarks(node: MinimalNode): number[] {
    const here = node.truncated === true && typeof node.mark === 'number' ? [node.mark] : [];
    const kids = Array.isArray(node.children) ? node.children : [];
    return kids.reduce((acc, k) => acc.concat(truncatedMarks(k)), here);
}

describe('treeTruncate.truncate', () => {
    describe('maxDepth', () => {
        it('keeps only root + direct children at maxDepth 1 (grandchildren dropped)', () => {
            const out = truncate(fixtureTree(), { maxDepth: 1 });
            // root + CameraActor + Flex = 3; the LabelImpl grandchild is gone.
            expect(countNodes(out)).to.equal(3);
            const flex = (out.children as MinimalNode[])[1];
            expect(flex.type).to.equal('FlexLayoutImpl');
            expect(flex.children).to.equal(undefined);
        });

        it('stamps truncated:true on a parent whose children were cut by depth', () => {
            const out = truncate(fixtureTree(), { maxDepth: 1 });
            // The Flex had a child that was dropped → it is marked truncated.
            expect(truncatedMarks(out)).to.include(3);
            // The CameraActor had no children → it is NOT marked truncated.
            const camera = (out.children as MinimalNode[])[0];
            expect(camera.truncated).to.equal(undefined);
        });

        it('produces a smaller serialization than the full tree at maxDepth 1', () => {
            const full = JSON.stringify(fixtureTree());
            const bounded = JSON.stringify(truncate(fixtureTree(), { maxDepth: 1 }));
            expect(bounded.length).to.be.lessThan(full.length);
        });

        it('keeps only the root at maxDepth 0 and marks it truncated', () => {
            const out = truncate(fixtureTree(), { maxDepth: 0 });
            expect(countNodes(out)).to.equal(1);
            expect(out.children).to.equal(undefined);
            expect(out.truncated).to.equal(true);
        });
    });

    describe('maxNodes', () => {
        it('emits at most maxNodes total nodes (budget 3 → 3 nodes)', () => {
            const out = truncate(fixtureTree(), { maxNodes: 3 });
            expect(countNodes(out)).to.equal(3);
        });

        it('emits at most maxNodes total nodes (budget 2 → 2 nodes)', () => {
            const out = truncate(fixtureTree(), { maxNodes: 2 });
            expect(countNodes(out)).to.be.at.most(2);
        });

        it('stamps truncated:true on the parent whose children were cut by budget', () => {
            const out = truncate(fixtureTree(), { maxNodes: 3 });
            // root + CameraActor + Flex fit; Flex's LabelImpl child is budget-cut.
            expect(truncatedMarks(out)).to.include(3);
        });

        it('keeps the root alone (truncated) when maxNodes is 1', () => {
            const out = truncate(fixtureTree(), { maxNodes: 1 });
            expect(countNodes(out)).to.equal(1);
            expect(out.truncated).to.equal(true);
        });
    });

    describe('purity & determinism', () => {
        it('never mutates the input tree', () => {
            const input = fixtureTree();
            const before = JSON.stringify(input);
            truncate(input, { maxDepth: 1, maxNodes: 2 });
            expect(JSON.stringify(input)).to.equal(before);
            // No synthetic truncated flag leaked onto the original.
            expect(truncatedMarks(input)).to.deep.equal([]);
        });

        it('returns a deep clone (mutating the result does not touch the input)', () => {
            const input = fixtureTree();
            const out = truncate(input);
            (out.children as MinimalNode[])[1].type = 'MUTATED';
            expect((input.children as MinimalNode[])[1].type).to.equal('FlexLayoutImpl');
        });

        it('preserves all nodes + harness fields when no limit is given', () => {
            const out = truncate(fixtureTree());
            expect(countNodes(out)).to.equal(4);
            const label = ((out.children as MinimalNode[])[1].children as MinimalNode[])[0];
            expect(label.id).to.equal('0/1/0');
            expect(label.bounds).to.deep.equal({ x: 381, y: 262, w: 262, h: 56 });
        });

        it('is deterministic — byte-identical output for identical input + opts', () => {
            const a = JSON.stringify(truncate(fixtureTree(), { maxDepth: 1, maxNodes: 3 }));
            const b = JSON.stringify(truncate(fixtureTree(), { maxDepth: 1, maxNodes: 3 }));
            expect(a).to.equal(b);
        });
    });
});
