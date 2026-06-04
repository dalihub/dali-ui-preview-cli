/*
 * treeQuery.test.ts — unit tests for the pure image↔tree lookups (M2/WU-4:
 * F2.3 nodeAt, F2.4 nodeById/toRegion).
 *
 * Pure-function tests over a crafted tree mirroring the real sample shape
 * (Layer full-canvas mark 1; CameraActor zero-box mark 2; FlexLayoutImpl
 * full-canvas mark 3; LabelImpl {381,262,262,56} mark 4): no docker, no fs.
 */

import { expect } from 'chai';
import { MinimalNode } from '../../treeModel';
import { nodeAt, nodeById, toRegion } from '../../treeQuery';

const W = 1024;
const H = 600;

/**
 * Crafted tree mirroring the real canonical shape, with marks pre-assigned in
 * pre-order. The label box {381,262,262,56} is the only small non-degenerate box.
 */
function fixtureTree(): MinimalNode {
    return {
        id: '0',
        type: 'Layer',
        role: 'panel',
        mark: 1,
        bounds: { x: 0, y: 0, w: W, h: H },
        children: [
            { id: '0/0', type: 'CameraActor', mark: 2, bounds: { x: 0, y: 0, w: 0, h: 0 } },
            {
                id: '0/1',
                type: 'FlexLayoutImpl',
                role: 'container',
                mark: 3,
                bounds: { x: 0, y: 0, w: W, h: H },
                children: [
                    {
                        id: '0/1/0',
                        type: 'LabelImpl',
                        role: 'label',
                        mark: 4,
                        bounds: { x: 381, y: 262, w: 262, h: 56 },
                    },
                ],
            },
        ],
    };
}

describe('treeQuery', () => {
    describe('nodeAt (F2.3 — smallest containing box)', () => {
        it('returns the LabelImpl (smallest area), not the root Layer, for a pixel inside the label', () => {
            const hit = nodeAt(fixtureTree(), 400, 280);
            expect(hit).to.not.equal(null);
            expect((hit as MinimalNode).id).to.equal('0/1/0');
            expect((hit as MinimalNode).type).to.equal('LabelImpl');
        });

        it('returns the Layer for a pixel inside the canvas but outside the label', () => {
            // (10,10) is in the full-canvas Layer/Flex but well outside the label box.
            const hit = nodeAt(fixtureTree(), 10, 10);
            expect(hit).to.not.equal(null);
            // Layer and Flex share the same full-canvas area; the deeper (larger
            // mark) Flex wins the tie — both are "the container", neither the label.
            expect((hit as MinimalNode).type).to.be.oneOf(['Layer', 'FlexLayoutImpl']);
            expect((hit as MinimalNode).id).to.not.equal('0/1/0');
        });

        it('returns null for an off-canvas pixel', () => {
            expect(nodeAt(fixtureTree(), 5000, 5000)).to.equal(null);
        });

        it('honours the half-open edge rule (x == bx+bw is OUTSIDE the box)', () => {
            // The label's right edge is x = 381 + 262 = 643; that column is excluded.
            const root = fixtureTree();
            const onRightEdge = nodeAt(root, 643, 280);
            expect(onRightEdge).to.not.equal(null);
            expect((onRightEdge as MinimalNode).id).to.not.equal('0/1/0');
            // One pixel inside (642) IS the label.
            const justInside = nodeAt(root, 642, 280);
            expect((justInside as MinimalNode).id).to.equal('0/1/0');
        });

        it('never returns a zero-area CameraActor, even at its own origin', () => {
            // (0,0) is the CameraActor's origin but its box is degenerate (w=h=0);
            // the full-canvas Layer/Flex must win instead.
            const hit = nodeAt(fixtureTree(), 0, 0);
            expect(hit).to.not.equal(null);
            expect((hit as MinimalNode).type).to.not.equal('CameraActor');
        });

        it('breaks area ties by the larger mark (deeper / more specific)', () => {
            // Layer (mark 1) and Flex (mark 3) both fill the canvas at (10,10).
            const hit = nodeAt(fixtureTree(), 10, 10);
            expect((hit as MinimalNode).mark).to.equal(3);
        });
    });

    describe('nodeById (F2.4)', () => {
        it('returns the right node for each real id', () => {
            const root = fixtureTree();
            expect((nodeById(root, '0') as MinimalNode).type).to.equal('Layer');
            expect((nodeById(root, '0/1') as MinimalNode).type).to.equal('FlexLayoutImpl');
            expect((nodeById(root, '0/1/0') as MinimalNode).type).to.equal('LabelImpl');
        });

        it('returns null for a bogus id', () => {
            expect(nodeById(fixtureTree(), '9/9/9')).to.equal(null);
        });
    });

    describe('toRegion (F2.4 — flat contract shape)', () => {
        it('projects exactly {id,mark,type,role,bounds{x,y,w,h}} and drops children', () => {
            const label = nodeById(fixtureTree(), '0/1/0') as MinimalNode;
            const region = toRegion(label);
            expect(region.id).to.equal('0/1/0');
            expect(region.mark).to.equal(4);
            expect(region.type).to.equal('LabelImpl');
            expect(region.role).to.equal('label');
            expect(region.bounds).to.deep.equal({ x: 381, y: 262, w: 262, h: 56 });
            expect(region).to.not.have.property('children');
        });

        it('omits role when the node has none', () => {
            const camera = nodeById(fixtureTree(), '0/0') as MinimalNode;
            const region = toRegion(camera);
            expect(region.id).to.equal('0/0');
            expect(region).to.not.have.property('role');
        });
    });
});
