import { expect } from 'chai';
import { checkTreeOnScreen, TreeNode } from '../../onScreenCheck';

// CLI rich-tree shape: geometry nested under `bounds`.
const onScreen: { root: TreeNode } = {
    root: {
        type: 'Layer', name: 'root', bounds: { x: 0, y: 0, w: 480, h: 320 }, visible: true, opacity: 1,
        children: [
            { type: 'ViewImpl', name: 'card', bounds: { x: 10, y: 10, w: 100, h: 100 }, visible: true, opacity: 1 },
        ],
    },
};

describe('checkTreeOnScreen', () => {
    it('passes when all drawn nodes are on-screen', () => {
        expect(checkTreeOnScreen(onScreen, 480, 320)).to.equal(null);
    });
    it('fails when a drawn node sits at a negative screen position', () => {
        const bad: { root: TreeNode } = { root: { ...onScreen.root,
            children: [{ type: 'ViewImpl', name: 'off', bounds: { x: -960, y: -540, w: 100, h: 100 }, visible: true, opacity: 1 }] } };
        const err = checkTreeOnScreen(bad, 480, 320);
        expect(err).to.be.a('string');
        expect(err).to.contain('off');
    });
    it('ignores invisible / zero-opacity / zero-size nodes', () => {
        const hidden: { root: TreeNode } = { root: { ...onScreen.root,
            children: [{ type: 'ViewImpl', name: 'hidden', bounds: { x: -960, y: -540, w: 100, h: 100 }, visible: false, opacity: 1 }] } };
        expect(checkTreeOnScreen(hidden, 480, 320)).to.equal(null);
    });
});
