/*
 * imageDiff.ts — pixel-level image comparison of a render against a baseline
 * (M4/WU-1: F4.1). Reads two PNGs, compares them with pixelmatch, and reports
 * how many pixels diverged + a pass/fail verdict, optionally writing a visual
 * diff PNG next to the actual image.
 *
 * Decode: `pngjs@7` `PNG.sync.read` → `{width,height,data}` (RGBA, 4 bytes/px),
 * exactly as overlayRenderer. Compare: `pixelmatch` (threshold default 0.1).
 *
 * pixelmatch@7 is a pure-ESM (`"type":"module"`) package whose default export is
 * the compare function. This module is compiled to CommonJS (tsconfig
 * `module:commonjs`), and a plain `import pixelmatch from 'pixelmatch'` would be
 * down-levelled to `require('pixelmatch')`, which throws `ERR_REQUIRE_ESM`. So we
 * (a) `import type` the signature only (erased at emit → no runtime require) and
 * (b) load the implementation through a `Function`-constructed native dynamic
 * `import()` that TypeScript cannot rewrite into a `require`, so Node honours it
 * as a real ESM import. The first load is memoised.
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): this module is pure
 * compute + fs and never writes to stdout; it returns a result the caller folds
 * into the stdout verdict (WU-3). It throws on unreadable/garbage PNGs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
// Type-only import: erased at emit, so it does NOT generate a CJS `require` of the
// ESM-only `pixelmatch`. Gives the real signature for the native-import handle below.
import type Pixelmatch from 'pixelmatch';

/** Native dynamic `import()` that TypeScript will NOT down-level to `require()`. */
const nativeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
) => Promise<{ default: typeof Pixelmatch }>;

/** Memoised pixelmatch implementation handle (first call resolves it via ESM). */
let pixelmatchPromise: Promise<typeof Pixelmatch> | undefined;

/** Resolve (once) the ESM `pixelmatch` default export from this CommonJS module. */
async function getPixelmatch(): Promise<typeof Pixelmatch> {
    if (pixelmatchPromise === undefined) {
        pixelmatchPromise = nativeImport('pixelmatch').then((mod) => mod.default);
    }
    return pixelmatchPromise;
}

/** Tunables for {@link imageDiff}. */
export interface ImageDiffOptions {
    /**
     * pixelmatch matching threshold (0..1); smaller is more sensitive. Default 0.1
     * (pixelmatch's own default). A pixel must differ by more than this to count.
     */
    threshold?: number;
    /**
     * Maximum tolerated diff ratio for `pass`. `pass = ratio <= failRatio`. Default
     * 0.01 (≤1% of pixels may differ). Dimension mismatches never pass.
     */
    failRatio?: number;
    /**
     * Where to write the visual diff PNG. Defaults to `<actualBasename>.diff.png`
     * next to the actual image. No diff PNG is written when dimensions differ.
     */
    diffPngPath?: string;
}

/** Outcome of an {@link imageDiff} comparison. */
export interface ImageDiffResult {
    /** True iff the two images share the same width AND height. */
    dimsMatch: boolean;
    /** Count of pixels pixelmatch flagged as different (0 when dims differ). */
    diffPixels: number;
    /** Total pixels compared = width*height (0 when dims differ). */
    totalPixels: number;
    /** `diffPixels / totalPixels` (0 when dims differ or there are no pixels). */
    ratio: number;
    /** Verdict: `dimsMatch && ratio <= failRatio`. */
    pass: boolean;
    /** Path of the written diff PNG, when one was produced (dims matched). */
    diffPngPath?: string;
}

const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_FAIL_RATIO = 0.01;

/**
 * Compare the rendered PNG at `actualPngPath` against `baselinePngPath`.
 *
 * If the two images differ in dimensions, returns
 * `{dimsMatch:false, pass:false, diffPixels:0, totalPixels:0, ratio:0}` and writes
 * NO diff image (pixelmatch requires equal dimensions). Otherwise runs pixelmatch
 * (threshold default 0.1), writes a visual diff PNG (default `<actual>.diff.png`),
 * and returns `ratio = diffPixels/totalPixels` with `pass = ratio <= failRatio`
 * (failRatio default 0.01).
 *
 * @throws  If either PNG is missing or not a decodable PNG (pngjs read error).
 */
export async function imageDiff(
    actualPngPath: string,
    baselinePngPath: string,
    opts: ImageDiffOptions = {},
): Promise<ImageDiffResult> {
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    const failRatio = opts.failRatio ?? DEFAULT_FAIL_RATIO;

    const [actualBuf, baselineBuf] = await Promise.all([
        fs.promises.readFile(actualPngPath),
        fs.promises.readFile(baselinePngPath),
    ]);
    const actual = PNG.sync.read(actualBuf);
    const baseline = PNG.sync.read(baselineBuf);

    // Dimension mismatch: cannot run pixelmatch (it requires equal dims). Report a
    // hard fail with no diff image, per the contract.
    if (actual.width !== baseline.width || actual.height !== baseline.height) {
        return {
            dimsMatch: false,
            diffPixels: 0,
            totalPixels: 0,
            ratio: 0,
            pass: false,
        };
    }

    const { width, height } = actual;
    const totalPixels = width * height;
    const diff = new PNG({ width, height });

    const pixelmatch = await getPixelmatch();
    const diffPixels = pixelmatch(actual.data, baseline.data, diff.data, width, height, {
        threshold,
    });

    const ratio = totalPixels > 0 ? diffPixels / totalPixels : 0;
    const pass = ratio <= failRatio;

    // Write the visual diff next to the actual image (or to an explicit override).
    const diffPngPath =
        opts.diffPngPath ??
        path.join(
            path.dirname(actualPngPath),
            `${path.basename(actualPngPath)}.diff.png`,
        );
    await fs.promises.writeFile(diffPngPath, PNG.sync.write(diff));

    return {
        dimsMatch: true,
        diffPixels,
        totalPixels,
        ratio,
        pass,
        diffPngPath,
    };
}
