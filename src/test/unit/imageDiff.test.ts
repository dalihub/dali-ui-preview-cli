/*
 * imageDiff.test.ts — unit tests for the pixel-level image diff (M4/WU-5: F4.1).
 * Builds small synthetic PNGs in-memory with pngjs, writes them to a tmpdir, and
 * runs imageDiff — no docker. Asserts the three contract cases: identical →
 * pass+ratio 0; a differing pixel block → fail; mismatched dimensions →
 * dimsMatch:false, pass:false (and no diff image).
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { imageDiff } from '../../diff/imageDiff';

/**
 * Build an opaque solid-colour PNG of `w`×`h`. Alpha is forced to 0xff on every
 * pixel so pixelmatch compares the RGB faithfully (transparent regions are treated
 * specially otherwise).
 */
function solidPng(w: number, h: number, r: number, g: number, b: number): PNG {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 0xff;
    }
    return png;
}

/** Paint an opaque [x,y,bw,bh] block of `png` to (r,g,b). */
function paintBlock(
    png: PNG,
    x: number,
    y: number,
    bw: number,
    bh: number,
    r: number,
    g: number,
    b: number,
): void {
    for (let py = y; py < y + bh; py++) {
        for (let px = x; px < x + bw; px++) {
            const idx = (py * png.width + px) * 4;
            png.data[idx] = r;
            png.data[idx + 1] = g;
            png.data[idx + 2] = b;
            png.data[idx + 3] = 0xff;
        }
    }
}

describe('imageDiff (F4.1)', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-imgdiff-'));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function write(name: string, png: PNG): string {
        const p = path.join(tmp, name);
        fs.writeFileSync(p, PNG.sync.write(png));
        return p;
    }

    it('identical images → pass, ratio 0, dimsMatch true, zero diff pixels', async () => {
        const actual = write('actual.png', solidPng(8, 8, 0x10, 0x20, 0x30));
        const baseline = write('baseline.png', solidPng(8, 8, 0x10, 0x20, 0x30));

        const res = await imageDiff(actual, baseline);

        expect(res.dimsMatch).to.equal(true);
        expect(res.diffPixels).to.equal(0);
        expect(res.totalPixels).to.equal(64);
        expect(res.ratio).to.equal(0);
        expect(res.pass).to.equal(true);
        // A diff PNG is written next to the actual and is re-readable.
        expect(res.diffPngPath).to.be.a('string');
        expect(fs.existsSync(res.diffPngPath as string)).to.equal(true);
        const diff = PNG.sync.read(fs.readFileSync(res.diffPngPath as string));
        expect(diff.width).to.equal(8);
        expect(diff.height).to.equal(8);
    });

    it('a differing pixel block → fail, ratio > 0, dims still match', async () => {
        const actual = solidPng(10, 10, 0x00, 0x00, 0x00);
        // Paint a bright red 4×4 block (16 of 100 px) so the ratio clears the
        // default 0.01 failRatio.
        paintBlock(actual, 0, 0, 4, 4, 0xff, 0x00, 0x00);
        const a = write('actual.png', actual);
        const b = write('baseline.png', solidPng(10, 10, 0x00, 0x00, 0x00));

        const res = await imageDiff(a, b);

        expect(res.dimsMatch).to.equal(true);
        expect(res.totalPixels).to.equal(100);
        expect(res.diffPixels).to.be.greaterThan(0);
        expect(res.ratio).to.be.greaterThan(0);
        expect(res.pass).to.equal(false);
    });

    it('a single differing pixel passes under the default 1% failRatio', async () => {
        // 1 of 100 px differs → ratio 0.01 == failRatio → pass (boundary is inclusive).
        const actual = solidPng(10, 10, 0x00, 0x00, 0x00);
        paintBlock(actual, 0, 0, 1, 1, 0xff, 0xff, 0xff);
        const a = write('actual.png', actual);
        const b = write('baseline.png', solidPng(10, 10, 0x00, 0x00, 0x00));

        const res = await imageDiff(a, b);

        expect(res.diffPixels).to.equal(1);
        expect(res.ratio).to.equal(0.01);
        expect(res.pass).to.equal(true);
    });

    it('a stricter failRatio turns the same single-pixel diff into a fail', async () => {
        const actual = solidPng(10, 10, 0x00, 0x00, 0x00);
        paintBlock(actual, 0, 0, 1, 1, 0xff, 0xff, 0xff);
        const a = write('actual.png', actual);
        const b = write('baseline.png', solidPng(10, 10, 0x00, 0x00, 0x00));

        const res = await imageDiff(a, b, { failRatio: 0 });

        expect(res.diffPixels).to.equal(1);
        expect(res.pass).to.equal(false);
    });

    it('mismatched dimensions → dimsMatch:false, pass:false, no diff image', async () => {
        const a = write('actual.png', solidPng(8, 8, 0x10, 0x20, 0x30));
        const b = write('baseline.png', solidPng(16, 8, 0x10, 0x20, 0x30));

        const res = await imageDiff(a, b);

        expect(res.dimsMatch).to.equal(false);
        expect(res.pass).to.equal(false);
        expect(res.diffPixels).to.equal(0);
        expect(res.totalPixels).to.equal(0);
        expect(res.ratio).to.equal(0);
        expect(res.diffPngPath).to.equal(undefined);
    });

    it('writes the diff PNG to an explicit override path when given', async () => {
        const a = write('actual.png', solidPng(8, 8, 0x10, 0x20, 0x30));
        const b = write('baseline.png', solidPng(8, 8, 0x10, 0x20, 0x30));
        const out = path.join(tmp, 'custom.diff.png');

        const res = await imageDiff(a, b, { diffPngPath: out });

        expect(res.diffPngPath).to.equal(out);
        expect(fs.existsSync(out)).to.equal(true);
    });
});
