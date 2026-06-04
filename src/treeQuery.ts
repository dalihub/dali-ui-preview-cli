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

import { MinimalNode } from './treeModel';

/**
 * A flat record lifted off a `MinimalNode` — the exact shape the CLI prints for
 * `--at` / `--node` (the stdout contract lives in ONE place: {@link toRegion}).
 */
export interface NodeRegion {
    /** Structural id (harness-authored child-index path, e.g. "0/1/0"). */
    id: string;
    /** Stable ordinal mark (1-based; the number drawn on the overlay). */
    mark: number;
    /** Concrete node type (e.g. "LabelImpl"). */
    type: string;
    /** Semantic role (e.g. "label", "container"); may be absent. */
    role?: string;
    /** Image-space box: x,y top-left, w,h size in pixels. */
    bounds: { x: number; y: number; w: number; h: number };
}

/** A `bounds` object known to have four finite numeric edges. */
interface NumericBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Read a node's `bounds` as four finite numbers, or null when it is missing or any
 * edge is non-numeric. Keeps the query functions from matching on garbage boxes.
 */
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
 * Visit every node of the tree in pre-order (parent before children, children in
 * array order), invoking `visit` on each. Skips null/non-object children. A small
 * shared iteration helper so the queries do not each re-implement the walk.
 */
export function forEachNode(root: MinimalNode, visit: (node: MinimalNode) => void): void {
    const walk = (node: MinimalNode): void => {
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
export function nodeAt(root: MinimalNode, x: number, y: number): MinimalNode | null {
    let best: MinimalNode | null = null;
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
export function nodeById(root: MinimalNode, id: string): MinimalNode | null {
    let found: MinimalNode | null = null;
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
export function toRegion(node: MinimalNode): NodeRegion {
    const b = numericBounds(node) ?? { x: 0, y: 0, w: 0, h: 0 };
    const region: NodeRegion = {
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
