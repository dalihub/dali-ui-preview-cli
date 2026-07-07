"use strict";
/*
 * treeQuery.ts — pure image↔tree lookups over the annotated canonical tree
 * (M2/WU-2: F2.3 coord→node, F2.4 id→node region).
 *
 * These are PURE functions of the `MinimalNode` tree `buildTree` returns (which now
 * carries the M2 `mark` from the single buildTree DFS — Inv-1): no fs, no docker, no
 * printing, no process state. That is deliberate — the CLI (WU-3) wires them onto
 * `--at` / `--node`, and WU-4 unit-tests them directly with no docker.
 *
 * `bounds` is a nested `{x,y,w,h}` object on every node (harness-authored, passed
 * through by `treeModel`); internal `CameraActor` nodes carry a degenerate box
 * (`w==0,h==0`, ADR-008), so every query filters on `w>0 && h>0` and they never
 * match.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.forEachNode = forEachNode;
exports.nodeAt = nodeAt;
exports.nodeById = nodeById;
exports.toRegion = toRegion;
/**
 * Read a node's `bounds` as four finite numbers, or null when it is missing or any
 * edge is non-numeric. Keeps the query functions from matching on garbage boxes.
 */
function numericBounds(node) {
    const b = node.bounds;
    if (b === null || typeof b !== 'object') {
        return null;
    }
    const { x, y, w, h } = b;
    if (typeof x !== 'number' || !Number.isFinite(x) ||
        typeof y !== 'number' || !Number.isFinite(y) ||
        typeof w !== 'number' || !Number.isFinite(w) ||
        typeof h !== 'number' || !Number.isFinite(h)) {
        return null;
    }
    return { x, y, w, h };
}
/**
 * Visit every node of the tree in pre-order (parent before children, children in
 * array order), invoking `visit` on each. Skips null/non-object children. A small
 * shared iteration helper so the queries do not each re-implement the walk.
 */
function forEachNode(root, visit) {
    const walk = (node) => {
        visit(node);
        const children = node.children;
        if (Array.isArray(children)) {
            for (const child of children) {
                if (child !== null && typeof child === 'object') {
                    walk(child);
                }
            }
        }
    };
    walk(root);
}
/**
 * Coordinate → node (F2.3). Return the **topmost = smallest-area** node whose
 * `bounds` contain the pixel (x,y), or `null` when none does.
 *
 * Containment uses a HALF-OPEN rule — `bx <= x < bx+bw && by <= y < by+bh` — so a
 * pixel exactly on the right/bottom edge belongs to the neighbouring box, never two
 * boxes at once. Only NON-DEGENERATE boxes (`w>0 && h>0`) are considered, so the
 * zero-area `CameraActor` boxes never match. Among containing boxes the smallest
 * `w*h` wins (the most specific control, e.g. a label inside the full-canvas Layer);
 * ties break by the LARGER `mark` (deeper / later in pre-order = more specific) for
 * a deterministic pick. Nodes with missing/non-numeric `bounds` are skipped.
 */
function nodeAt(root, x, y) {
    let best = null;
    let bestArea = Infinity;
    let bestMark = -Infinity;
    forEachNode(root, (node) => {
        const b = numericBounds(node);
        if (b === null || b.w <= 0 || b.h <= 0) {
            return;
        }
        // Half-open containment: right/bottom edges are exclusive.
        if (!(b.x <= x && x < b.x + b.w && b.y <= y && y < b.y + b.h)) {
            return;
        }
        const area = b.w * b.h;
        const mark = typeof node.mark === 'number' ? node.mark : -Infinity;
        if (area < bestArea || (area === bestArea && mark > bestMark)) {
            best = node;
            bestArea = area;
            bestMark = mark;
        }
    });
    return best;
}
/**
 * id → node (F2.4). DFS the tree and return the first node whose `id` equals `id`
 * (ids are unique per F1.3), or `null` when no node has that id.
 */
function nodeById(root, id) {
    let found = null;
    forEachNode(root, (node) => {
        if (found === null && node.id === id) {
            found = node;
        }
    });
    return found;
}
/**
 * Project a node onto the flat {@link NodeRegion} contract shape printed by
 * `--at` / `--node`: `{id, mark, type, role, bounds{x,y,w,h}}`, dropping `children`
 * and every other harness field. Defined here so the CLI's stdout shape lives in
 * one place. Best-effort coercion: missing pieces become safe defaults rather than
 * throwing (the CLI only calls this on nodes the queries returned).
 */
function toRegion(node) {
    const b = numericBounds(node) ?? { x: 0, y: 0, w: 0, h: 0 };
    const region = {
        id: typeof node.id === 'string' ? node.id : '',
        mark: typeof node.mark === 'number' ? node.mark : 0,
        type: node.type,
        bounds: { x: b.x, y: b.y, w: b.w, h: b.h },
    };
    if (typeof node.role === 'string') {
        region.role = node.role;
    }
    return region;
}
