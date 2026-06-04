/*
 * overlayRenderer.ts — Set-of-Mark image annotator (M2/WU-2: F2.1).
 *
 * Reads the rendered PNG, draws a high-contrast rectangle outline around every
 * drawable node's `bounds`, and stamps that node's `mark` number near the box as a
 * tiny 3×5 bitmap-digit tag, then writes the annotated PNG. The numbers drawn are
 * the very `mark`s of the tree the JSON is built from (Inv-1) — the overlay reads
 * marks from the same annotated tree, it does not re-derive them.
 *
 * "Drawable" = numeric `bounds`, NON-DEGENERATE (`w>0 && h>0`), at least partially
 * on-canvas. That excludes the zero-area `CameraActor` boxes (ADR-008) and anything
 * fully off-canvas. Drawing is fully deterministic: fixed colours, a fixed font
 * bitmap, nodes drawn in `mark` order, no timestamps / text chunks.
 *
 * The PNG is RGBA, 4 bytes/px (`pngjs@7` `PNG.sync.read` → `{width,height,data}`).
 * The only side effects are the two fs calls (read src, write dest); everything
 * else is pure pixel arithmetic on the in-memory buffer.
 */

import * as fs from 'fs';
import { PNG } from 'pngjs';
import { MinimalNode } from './treeModel';
import { forEachNode } from './treeQuery';

/** Result of {@link renderOverlay}: which marks were actually drawn. */
export interface OverlayResult {
    /**
     * Sorted ascending list of the marks actually drawn — the on-canvas,
     * non-degenerate subset. The caller / tests assert mark-parity against the tree
     * (F2.2: this set ⊆ the tree's marks, and equals the set of drawable-node marks).
     */
    marksDrawn: number[];
}

/** Outline colour: opaque magenta `#FF00FF` — high contrast over any render. */
const OUTLINE = { r: 0xff, g: 0x00, b: 0xff } as const;
/** Tag background behind the digits: opaque black, so digits stay legible. */
const TAG_BG = { r: 0x00, g: 0x00, b: 0x00 } as const;
/** Digit ink: opaque white on the black tag. */
const TAG_INK = { r: 0xff, g: 0xff, b: 0xff } as const;

/** Digit glyph geometry. */
const GLYPH_W = 3;
const GLYPH_H = 5;
/** Pixel gap between adjacent digit glyphs inside a tag. */
const GLYPH_GAP = 1;
/** Padding (px) of black tag background around the digit run. */
const TAG_PAD = 1;

/**
 * 3×5 bitmap font for digits 0–9. Each entry is 5 rows of a 3-wide mask: a `1` bit
 * (read MSB-first across the 3 columns) is ink. Fixed at authoring time → the
 * overlay is byte-deterministic for a given mark set.
 */
const DIGIT_GLYPHS: Record<string, readonly number[]> = {
    '0': [0b111, 0b101, 0b101, 0b101, 0b111],
    '1': [0b010, 0b110, 0b010, 0b010, 0b111],
    '2': [0b111, 0b001, 0b111, 0b100, 0b111],
    '3': [0b111, 0b001, 0b111, 0b001, 0b111],
    '4': [0b101, 0b101, 0b111, 0b001, 0b001],
    '5': [0b111, 0b100, 0b111, 0b001, 0b111],
    '6': [0b111, 0b100, 0b111, 0b101, 0b111],
    '7': [0b111, 0b001, 0b010, 0b010, 0b010],
    '8': [0b111, 0b101, 0b111, 0b101, 0b111],
    '9': [0b111, 0b101, 0b111, 0b001, 0b111],
};

/** Numeric, finite `bounds` lifted off a node, or null when missing/non-numeric. */
interface NumericBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

function numericBounds(node: MinimalNode): NumericBounds | null {
    const b = node.bounds as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
    if (b === null || typeof b !== 'object') {
        return null;
    }
    const { x, y, w, h } = b;
    if (
        typeof x !== 'number' || !Number.isFinite(x) ||
        typeof y !== 'number' || !Number.isFinite(y) ||
        typeof w !== 'number' || !Number.isFinite(w) ||
        typeof h !== 'number' || !Number.isFinite(h)
    ) {
        return null;
    }
    return { x, y, w, h };
}

/**
 * Set one pixel to an opaque RGB colour. Bounds-checked (a write outside the canvas
 * is a silent no-op) so callers can clamp loosely without corrupting the buffer.
 */
function setPixel(
    data: Buffer,
    width: number,
    height: number,
    x: number,
    y: number,
    color: { r: number; g: number; b: number },
): void {
    if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
    }
    const idx = (y * width + x) * 4;
    data[idx] = color.r;
    data[idx + 1] = color.g;
    data[idx + 2] = color.b;
    data[idx + 3] = 0xff;
}

/**
 * Draw a 1-px rectangle outline along the four edges of `{x,y,w,h}`. Edges are
 * clamped to the canvas by `setPixel`, so a box hanging off the canvas draws only
 * its on-canvas portion.
 */
function drawRectOutline(
    data: Buffer,
    width: number,
    height: number,
    x: number,
    y: number,
    w: number,
    h: number,
    color: { r: number; g: number; b: number },
): void {
    const left = Math.round(x);
    const top = Math.round(y);
    const right = Math.round(x + w) - 1;
    const bottom = Math.round(y + h) - 1;

    for (let px = left; px <= right; px++) {
        setPixel(data, width, height, px, top, color);
        setPixel(data, width, height, px, bottom, color);
    }
    for (let py = top; py <= bottom; py++) {
        setPixel(data, width, height, left, py, color);
        setPixel(data, width, height, right, py, color);
    }
}

/**
 * Fill a solid rectangle (inclusive of its top-left origin, `fw`×`fh` pixels) with
 * an opaque colour. Used for the tag background behind the digits.
 */
function fillRect(
    data: Buffer,
    width: number,
    height: number,
    x: number,
    y: number,
    fw: number,
    fh: number,
    color: { r: number; g: number; b: number },
): void {
    for (let py = y; py < y + fh; py++) {
        for (let px = x; px < x + fw; px++) {
            setPixel(data, width, height, px, py, color);
        }
    }
}

/**
 * Draw a single digit glyph with its top-left at (x,y): ink pixels where the 3×5
 * font mask has a set bit.
 */
function drawGlyph(
    data: Buffer,
    width: number,
    height: number,
    digit: string,
    x: number,
    y: number,
): void {
    const glyph = DIGIT_GLYPHS[digit];
    if (glyph === undefined) {
        return;
    }
    for (let row = 0; row < GLYPH_H; row++) {
        const bits = glyph[row];
        for (let col = 0; col < GLYPH_W; col++) {
            // Read columns MSB-first across the 3-wide mask.
            if ((bits & (1 << (GLYPH_W - 1 - col))) !== 0) {
                setPixel(data, width, height, x + col, y + row, TAG_INK);
            }
        }
    }
}

/**
 * Draw `mark`'s decimal digits as a filled black tag with white digits, anchored so
 * the tag sits just inside the top-left corner of the box (kept within the canvas
 * when the corner is near an edge).
 */
function drawMarkTag(
    data: Buffer,
    width: number,
    height: number,
    boxX: number,
    boxY: number,
    mark: number,
): void {
    const text = String(mark);
    const runW = text.length * GLYPH_W + (text.length - 1) * GLYPH_GAP;
    const tagW = runW + TAG_PAD * 2;
    const tagH = GLYPH_H + TAG_PAD * 2;

    // Anchor at the box's top-left, clamped so the whole tag stays on canvas.
    let tagX = Math.round(boxX);
    let tagY = Math.round(boxY);
    if (tagX + tagW > width) {
        tagX = width - tagW;
    }
    if (tagY + tagH > height) {
        tagY = height - tagH;
    }
    if (tagX < 0) {
        tagX = 0;
    }
    if (tagY < 0) {
        tagY = 0;
    }

    fillRect(data, width, height, tagX, tagY, tagW, tagH, TAG_BG);

    let cursorX = tagX + TAG_PAD;
    const cursorY = tagY + TAG_PAD;
    for (const ch of text) {
        drawGlyph(data, width, height, ch, cursorX, cursorY);
        cursorX += GLYPH_W + GLYPH_GAP;
    }
}

/**
 * Read the PNG at `srcPngPath`, draw a Set-of-Mark overlay for `root` (a rectangle
 * outline + the `mark` number for every drawable node), and write the annotated PNG
 * to `outPngPath`.
 *
 * @param srcPngPath  The rendered source PNG (e.g. `RenderResult.pngPath`).
 * @param root        The annotated canonical tree (carries the M2 `mark`).
 * @param outPngPath  Where to write the annotated PNG.
 * @returns           `{ marksDrawn }` — the sorted marks actually drawn (the
 *                    on-canvas, non-degenerate subset), for mark-parity assertions.
 */
export async function renderOverlay(
    srcPngPath: string,
    root: MinimalNode,
    outPngPath: string,
): Promise<OverlayResult> {
    const png = PNG.sync.read(await fs.promises.readFile(srcPngPath));
    const { width, height, data } = png;

    // Collect drawable nodes: numeric bounds, non-degenerate, at least partially
    // on-canvas. Draw in mark order for determinism.
    const drawables: Array<{ mark: number; b: NumericBounds }> = [];
    forEachNode(root, (node) => {
        const b = numericBounds(node);
        if (b === null || b.w <= 0 || b.h <= 0) {
            return;
        }
        const onCanvas = b.x < width && b.y < height && b.x + b.w > 0 && b.y + b.h > 0;
        if (!onCanvas) {
            return;
        }
        const mark = typeof node.mark === 'number' ? node.mark : 0;
        drawables.push({ mark, b });
    });
    drawables.sort((a, c) => a.mark - c.mark);

    for (const { mark, b } of drawables) {
        drawRectOutline(data, width, height, b.x, b.y, b.w, b.h, OUTLINE);
        drawMarkTag(data, width, height, b.x, b.y, mark);
    }

    await fs.promises.writeFile(outPngPath, PNG.sync.write(png));

    return { marksDrawn: drawables.map((d) => d.mark) };
}
