/*
 * treeDiff.test.ts — unit tests for the id-keyed structural tree diff (M4/WU-5:
 * F4.2). Pure-function tests over crafted MinimalNode trees mirroring the real
 * canonical shape — no docker, no fs. Covers: self-diff → all-empty; a changed
 * `bounds` → that id in `changed`; an added node; a removed node; multi-field
 * change; and deterministic id-sorted ordering.
 */

import { expect } from 'chai';
import { MinimalNode } from '../../treeModel';
import { treeDiff } from '../../diff/treeDiff';

const W = 1024;
const H = 600;

/** Crafted tree: Layer > [CameraActor, Flex > Label]. Stable ids on every node. */
function fixtureTree(): MinimalNode {
    return {
        id: '0',
        type: 'Layer',
        role: 'panel',
        name: 'RootLayer',
        bounds: { x: 0, y: 0, w: W, h: H },
        children: [
            { id: '0/0', type: 'CameraActor', bounds: { x: 0, y: 0, w: 0, h: 0 } },
            {
                id: '0/1',
                type: 'FlexLayoutImpl',
                role: 'container',
                bounds: { x: 0, y: 0, w: W, h: H },
                children: [
                    {
                        id: '0/1/0',
                        type: 'LabelImpl',
                        role: 'label',
                        name: 'Hello',
                        sourceLine: 12,
                        bounds: { x: 381, y: 262, w: 262, h: 56 },
                    },
                ],
            },
        ],
    };
}

/** Deep clone via JSON (the fixtures are plain JSON-safe data). */
function clone(node: MinimalNode): MinimalNode {
    return JSON.parse(JSON.stringify(node)) as MinimalNode;
}

describe('treeDiff (F4.2)', () => {
    it('a tree diffed against itself → all three sets empty', () => {
        const res = treeDiff(fixtureTree(), fixtureTree());
        expect(res.added).to.deep.equal([]);
        expect(res.removed).to.deep.equal([]);
        expect(res.changed).to.deep.equal([]);
    });

    it('a changed bounds → that id reported in changed with field "bounds"', () => {
        const current = fixtureTree();
        const target = clone(current);
        // Move the label's box in the TARGET so current differs from it.
        (target.children as MinimalNode[])[1].children![0].bounds = {
            x: 100,
            y: 100,
            w: 262,
            h: 56,
        };

        const res = treeDiff(current, target);

        expect(res.added).to.deep.equal([]);
        expect(res.removed).to.deep.equal([]);
        expect(res.changed).to.have.length(1);
        expect(res.changed[0].id).to.equal('0/1/0');
        expect(res.changed[0].fields).to.deep.equal(['bounds']);
    });

    it('reports multiple changed fields in canonical order (scalars then bounds)', () => {
        const current = fixtureTree();
        const target = clone(current);
        const tgtLabel = (target.children as MinimalNode[])[1].children![0];
        tgtLabel.type = 'TextLabel';
        tgtLabel.name = 'Goodbye';
        tgtLabel.sourceLine = 99;
        tgtLabel.bounds = { x: 1, y: 2, w: 3, h: 4 };

        const res = treeDiff(current, target);

        expect(res.changed).to.have.length(1);
        expect(res.changed[0].id).to.equal('0/1/0');
        // type, role, name, sourceLine, then bounds — role is unchanged so omitted.
        expect(res.changed[0].fields).to.deep.equal(['type', 'name', 'sourceLine', 'bounds']);
    });

    it('a node only in current → added; lists its type', () => {
        const current = fixtureTree();
        const target = clone(current);
        // Add a second label to CURRENT only.
        (current.children as MinimalNode[])[1].children!.push({
            id: '0/1/1',
            type: 'ImageView',
            bounds: { x: 0, y: 0, w: 10, h: 10 },
        });

        const res = treeDiff(current, target);

        expect(res.removed).to.deep.equal([]);
        expect(res.changed).to.deep.equal([]);
        expect(res.added).to.deep.equal([{ id: '0/1/1', type: 'ImageView' }]);
    });

    it('a node only in target → removed; lists its type', () => {
        const current = fixtureTree();
        const target = clone(current);
        // Add a node to TARGET only → it is "removed" relative to current.
        (target.children as MinimalNode[])[1].children!.push({
            id: '0/1/1',
            type: 'ImageView',
            bounds: { x: 0, y: 0, w: 10, h: 10 },
        });

        const res = treeDiff(current, target);

        expect(res.added).to.deep.equal([]);
        expect(res.changed).to.deep.equal([]);
        expect(res.removed).to.deep.equal([{ id: '0/1/1', type: 'ImageView' }]);
    });

    it('orders added/removed/changed deterministically by id', () => {
        const current = fixtureTree();
        const target = clone(current);
        // Two adds in current (out of id order), to assert sorting.
        const flexChildren = (current.children as MinimalNode[])[1].children!;
        flexChildren.push({ id: '0/1/2', type: 'B', bounds: { x: 0, y: 0, w: 1, h: 1 } });
        flexChildren.push({ id: '0/1/1', type: 'A', bounds: { x: 0, y: 0, w: 1, h: 1 } });

        const res = treeDiff(current, target);

        expect(res.added.map((n) => n.id)).to.deep.equal(['0/1/1', '0/1/2']);
    });

    it('treats two differing bounds as unequal even when other fields match', () => {
        const current = fixtureTree();
        const target = clone(current);
        // Only w differs on the root.
        (target.bounds as { w: number }).w = W - 1;

        const res = treeDiff(current, target);

        expect(res.changed.map((c) => c.id)).to.deep.equal(['0']);
        expect(res.changed[0].fields).to.deep.equal(['bounds']);
    });
});
