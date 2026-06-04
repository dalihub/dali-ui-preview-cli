/*
 * overlayRenderer.ts — Set-of-Mark image annotator (M2/WU-2: F2.1).
 *
 * Reads the rendered PNG, draws a high-contrast rectangle outline around every
 * drawable node's `bounds`, and stamps that node's `mark` number near the box as an
 * upscaled bitmap-digit tag (a filled tag for contrast), then writes the annotated
 * PNG. The numbers drawn are the very `mark`s of the tree the JSON is built from
 * (Inv-1) — the overlay reads marks from the same annotated tree, not re-derived.
 *
 * "Drawable" = numeric `bounds`, NON-DEGENERATE (`w>0 && h>0`), at least partially
 * on-canvas. That excludes the zero-area `CameraActor` boxes (ADR-008) and anything
 * fully off-canvas. Drawing is fully deterministic: fixed colours, a fixed font
 * bitmap, a fixed integer upscale, nodes drawn in `mark` order, no timestamps.
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
/** Tag background behind the digits: opaque magenta, so the tag reads as the box's. */
const TAG_BG = { r: 0xff, g: 0x00, b: 0xff } as const;
/** Digit ink: opaque white on the magenta tag (high contrast, legible). */
const TAG_INK = { r: 0xff, g: 0xff, b: 0xff } as const;

/** Box outline thickness in px (thicker = visible over busy renders). */
const OUTLINE_THICKNESS = 2;
/** Base digit glyph geometry (a 3×5 bitmap font). */
const GLYPH_W = 3;
const GLYPH_H = 5;
/**
 * Integer upscale for the mark tag so the digits are actually legible: each font
 * pixel becomes a `GLYPH_SCALE`×`GLYPH_SCALE` block, so a digit renders at
 * (3·S)×(5·S) px (S=5 → 15×25). Fixed → the overlay stays byte-deterministic.
 */
const GLYPH_SCALE = 5;
/** Gap between adjacent digit glyphs, in *font* px (scaled with the digits). */
const GLYPH_GAP = 1;
/** Padding around the digit run inside the tag, in *font* px (scaled). */
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
 * Draw a `thickness`-px rectangle outline (concentric rings) along the edges of
 * `{x,y,w,h}`. Edges are clamped to the canvas by `setPixel`, so a box hanging off
 * the canvas draws only its on-canvas portion.
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
    thickness: number = OUTLINE_THICKNESS,
): void {
    const left = Math.round(x);
    const top = Math.round(y);
    const right = Math.round(x + w) - 1;
    const bottom = Math.round(y + h) - 1;

    for (let t = 0; t < thickness; t++) {
        for (let px = left + t; px <= right - t; px++) {
            setPixel(data, width, height, px, top + t, color);
            setPixel(data, width, height, px, bottom - t, color);
        }
        for (let py = top + t; py <= bottom - t; py++) {
            setPixel(data, width, height, left + t, py, color);
            setPixel(data, width, height, right - t, py, color);
        }
    }
}

/**
 * Fill a solid rectangle (top-left origin, `fw`×`fh` px) with an opaque colour.
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
 * Draw a single digit glyph (upscaled by {@link GLYPH_SCALE}) with its top-left at
 * (x,y): each set font-bit becomes a `GLYPH_SCALE`×`GLYPH_SCALE` ink block.
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
                fillRect(
                    data, width, height,
                    x + col * GLYPH_SCALE, y + row * GLYPH_SCALE,
                    GLYPH_SCALE, GLYPH_SCALE, TAG_INK,
                );
            }
        }
    }
}

/**
 * Draw `mark`'s decimal digits as a filled magenta tag with white (upscaled) digits,
 * anchored so the tag sits just inside the top-left corner of the box (kept within
 * the canvas when the corner is near an edge).
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
    const glyphW = GLYPH_W * GLYPH_SCALE;
    const glyphH = GLYPH_H * GLYPH_SCALE;
    const gap = GLYPH_GAP * GLYPH_SCALE;
    const pad = TAG_PAD * GLYPH_SCALE;

    const runW = text.length * glyphW + (text.length - 1) * gap;
    const tagW = runW + pad * 2;
    const tagH = glyphH + pad * 2;

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

    let cursorX = tagX + pad;
    const cursorY = tagY + pad;
    for (const ch of text) {
        drawGlyph(data, width, height, ch, cursorX, cursorY);
        cursorX += glyphW + gap;
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

    // Draw all outlines first, then all tags, so a neighbouring box edge never
    // overdraws a tag's digits.
    for (const { b } of drawables) {
        drawRectOutline(data, width, height, b.x, b.y, b.w, b.h, OUTLINE);
    }
    for (const { mark, b } of drawables) {
        drawMarkTag(data, width, height, b.x, b.y, mark);
    }

    await fs.promises.writeFile(outPngPath, PNG.sync.write(png));

    return { marksDrawn: drawables.map((d) => d.mark) };
}
