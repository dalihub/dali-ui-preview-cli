"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageDiff = imageDiff;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pngjs_1 = require("pngjs");
/** Native dynamic `import()` that TypeScript will NOT down-level to `require()`. */
const nativeImport = new Function('specifier', 'return import(specifier)');
/** Memoised pixelmatch implementation handle (first call resolves it via ESM). */
let pixelmatchPromise;
/** Resolve (once) the ESM `pixelmatch` default export from this CommonJS module. */
async function getPixelmatch() {
    if (pixelmatchPromise === undefined) {
        pixelmatchPromise = nativeImport('pixelmatch').then((mod) => mod.default);
    }
    return pixelmatchPromise;
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
async function imageDiff(actualPngPath, baselinePngPath, opts = {}) {
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    const failRatio = opts.failRatio ?? DEFAULT_FAIL_RATIO;
    const [actualBuf, baselineBuf] = await Promise.all([
        fs.promises.readFile(actualPngPath),
        fs.promises.readFile(baselinePngPath),
    ]);
    const actual = pngjs_1.PNG.sync.read(actualBuf);
    const baseline = pngjs_1.PNG.sync.read(baselineBuf);
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
    const diff = new pngjs_1.PNG({ width, height });
    const pixelmatch = await getPixelmatch();
    const diffPixels = pixelmatch(actual.data, baseline.data, diff.data, width, height, {
        threshold,
    });
    const ratio = totalPixels > 0 ? diffPixels / totalPixels : 0;
    const pass = ratio <= failRatio;
    // Write the visual diff next to the actual image (or to an explicit override).
    const diffPngPath = opts.diffPngPath ??
        path.join(path.dirname(actualPngPath), `${path.basename(actualPngPath)}.diff.png`);
    await fs.promises.writeFile(diffPngPath, pngjs_1.PNG.sync.write(diff));
    return {
        dimsMatch: true,
        diffPixels,
        totalPixels,
        ratio,
        pass,
        diffPngPath,
    };
}
