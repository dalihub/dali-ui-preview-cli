/*
 * overlayRenderer.test.ts — unit tests for the Set-of-Mark annotator (M2/WU-4:
 * F2.1). Uses a tmpdir PNG written/read via pngjs — no docker. Asserts behaviour
 * (same dims, re-readable, pixels changed, marksDrawn subset) rather than exact
 * pixels, so it stays robust to the digit-font choice.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { MinimalNode } from '../../treeModel';
import { renderOverlay } from '../../overlayRenderer';

const W = 1024;
const H = 600;

/** Crafted tree: Layer(full) > [CameraActor(zero box), Flex(full) > Label(small)]. */
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

describe('overlayRenderer.renderOverlay (F2.1)', () => {
    let tmp: string;
    let srcPath: string;
    let outPath: string;
    let srcBuffer: Buffer;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-ov-'));
        srcPath = path.join(tmp, 'src.png');
        outPath = path.join(tmp, 'out.png');
        // Solid mid-grey source PNG.
        const src = new PNG({ width: W, height: H });
        src.data.fill(0x20);
        srcBuffer = PNG.sync.write(src);
        fs.writeFileSync(srcPath, srcBuffer);
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('writes a non-empty PNG of the same dimensions, re-readable by pngjs', async () => {
        await renderOverlay(srcPath, fixtureTree(), outPath);
        expect(fs.existsSync(outPath)).to.equal(true);
        expect(fs.statSync(outPath).size).to.be.greaterThan(0);
        const out = PNG.sync.read(fs.readFileSync(outPath));
        expect(out.width).to.equal(W);
        expect(out.height).to.equal(H);
    });

    it('changes some pixels (something was drawn)', async () => {
        await renderOverlay(srcPath, fixtureTree(), outPath);
        const out = PNG.sync.read(fs.readFileSync(outPath));
        const src = PNG.sync.read(srcBuffer);
        expect(Buffer.compare(out.data, src.data)).to.not.equal(0);
    });

    it('returns marksDrawn that excludes the zero-area CameraActor and includes the label', async () => {
        const res = await renderOverlay(srcPath, fixtureTree(), outPath);
        const treeMarks = new Set([1, 2, 3, 4]);
        // Subset of the tree marks (Inv-1).
        expect(res.marksDrawn.every((m) => treeMarks.has(m))).to.equal(true);
        // Non-empty.
        expect(res.marksDrawn.length).to.be.greaterThan(0);
        // The degenerate CameraActor (mark 2) is never drawn.
        expect(res.marksDrawn).to.not.include(2);
        // The label (mark 4) is drawn.
        expect(res.marksDrawn).to.include(4);
        // The full-canvas Layer (1) and Flex (3) are drawn too.
        expect(res.marksDrawn).to.include(1);
        expect(res.marksDrawn).to.include(3);
    });

    it('returns marksDrawn sorted ascending', async () => {
        const res = await renderOverlay(srcPath, fixtureTree(), outPath);
        const sorted = [...res.marksDrawn].sort((a, b) => a - b);
        expect(res.marksDrawn).to.deep.equal(sorted);
    });

    it('skips a fully off-canvas node', async () => {
        const root = fixtureTree();
        (root.children as MinimalNode[]).push({
            id: '0/2',
            type: 'LabelImpl',
            role: 'label',
            mark: 5,
            bounds: { x: 5000, y: 5000, w: 100, h: 40 },
        });
        const res = await renderOverlay(srcPath, root, outPath);
        expect(res.marksDrawn).to.not.include(5);
    });

    it('is deterministic: two runs produce byte-identical output', async () => {
        const outA = path.join(tmp, 'a.png');
        const outB = path.join(tmp, 'b.png');
        await renderOverlay(srcPath, fixtureTree(), outA);
        await renderOverlay(srcPath, fixtureTree(), outB);
        expect(Buffer.compare(fs.readFileSync(outA), fs.readFileSync(outB))).to.equal(0);
    });
});
