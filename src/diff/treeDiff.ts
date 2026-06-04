/*
 * treeDiff.ts — structural diff of a current scene tree against a target tree
 * (M4/WU-2: F4.2), keyed on the stable per-node `id` (M1/F1.3). Lets an agent ask
 * "did my change reach the goal tree?" by reporting which nodes were added,
 * removed, or had their salient fields change.
 *
 * Both trees are indexed by `id` with the shared `treeQuery.forEachNode` pre-order
 * walk (so the walk semantics — null/non-object child guards — match the rest of
 * the CLI). Then, over the union of ids:
 *   - added   = ids present in `current` but NOT in `target`;
 *   - removed = ids present in `target` but NOT in `current`;
 *   - changed = ids present in BOTH whose `type` / `role` / `name` / `sourceLine`
 *               differ, or whose `bounds` differ (deep compare of x,y,w,h).
 *
 * Output ordering is deterministic (Inv-3): every list is sorted by `id`, and each
 * changed entry's `fields` are in a fixed canonical order. The diff is a pure
 * function of its two inputs — no fs, no process state.
 */

import { MinimalNode } from './../treeModel';
import { forEachNode } from './../treeQuery';

/** A node that was added (in current, not target) or removed (in target, not current). */
export interface TreeDiffNode {
    /** The node's stable structural id. */
    id: string;
    /** Its concrete type, for a readable diff (best-effort; '' if somehow absent). */
    type: string;
}

/** A node present in both trees whose listed fields differ between them. */
export interface TreeDiffChange {
    /** The node's stable structural id (same in both trees). */
    id: string;
    /** Names of the fields that differ, in canonical order (a subset of FIELD_KEYS). */
    fields: string[];
}

/** Result of {@link treeDiff}: the three disjoint id-keyed change sets. */
export interface TreeDiffResult {
    /** Ids in `current` but not `target`, sorted by id. */
    added: TreeDiffNode[];
    /** Ids in `target` but not `current`, sorted by id. */
    removed: TreeDiffNode[];
    /** Ids in both whose fields differ, sorted by id. */
    changed: TreeDiffChange[];
}

/**
 * Scalar fields compared for a `changed` verdict, in the canonical order they are
 * reported. `bounds` is handled separately (deep compare) and appended last.
 */
const SCALAR_FIELDS = ['type', 'role', 'name', 'sourceLine'] as const;

/** Index every node of `root` by its `id` (last writer wins on a duplicate id). */
function indexById(root: MinimalNode): Map<string, MinimalNode> {
    const byId = new Map<string, MinimalNode>();
    forEachNode(root, (node) => {
        if (typeof node.id === 'string') {
            byId.set(node.id, node);
        }
    });
    return byId;
}

/** A node's `type` as a string, or '' when missing (keeps the diff total). */
function typeOf(node: MinimalNode): string {
    return typeof node.type === 'string' ? node.type : '';
}

/**
 * Deep-compare two `bounds` values by their four numeric edges. Returns true iff
 * both are objects with identical x/y/w/h (a missing edge compares as `undefined`,
 * so `{x:0}` differs from `{x:0,y:0,w:0,h:0}`). Two absent bounds are equal.
 */
function boundsEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true; // same ref or both undefined/null
    }
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }
    const ba = a as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    const bb = b as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    return ba.x === bb.x && ba.y === bb.y && ba.w === bb.w && ba.h === bb.h;
}

/**
 * Collect the names of the fields that differ between `cur` and `tgt`, in canonical
 * order: the scalar fields (`type`,`role`,`name`,`sourceLine`) first, then `bounds`.
 * Scalars are compared with strict `!==`; `bounds` with {@link boundsEqual}.
 */
function changedFields(cur: MinimalNode, tgt: MinimalNode): string[] {
    const fields: string[] = [];
    for (const key of SCALAR_FIELDS) {
        if (cur[key] !== tgt[key]) {
            fields.push(key);
        }
    }
    if (!boundsEqual(cur.bounds, tgt.bounds)) {
        fields.push('bounds');
    }
    return fields;
}

/**
 * Diff `current` against `target`, keyed by node `id`.
 *
 * @param current  The tree just rendered (the "is").
 * @param target   The reference tree to reach (the "should").
 * @returns        `{added, removed, changed}` — disjoint, each sorted by id; a
 *                 `changed` entry lists only the differing field names.
 */
export function treeDiff(current: MinimalNode, target: MinimalNode): TreeDiffResult {
    const cur = indexById(current);
    const tgt = indexById(target);

    const added: TreeDiffNode[] = [];
    const removed: TreeDiffNode[] = [];
    const changed: TreeDiffChange[] = [];

    // Added + changed: walk current's ids.
    for (const [id, curNode] of cur) {
        const tgtNode = tgt.get(id);
        if (tgtNode === undefined) {
            added.push({ id, type: typeOf(curNode) });
            continue;
        }
        const fields = changedFields(curNode, tgtNode);
        if (fields.length > 0) {
            changed.push({ id, fields });
        }
    }

    // Removed: ids only in target.
    for (const [id, tgtNode] of tgt) {
        if (!cur.has(id)) {
            removed.push({ id, type: typeOf(tgtNode) });
        }
    }

    const byId = (a: { id: string }, b: { id: string }): number =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    added.sort(byId);
    removed.sort(byId);
    changed.sort(byId);

    return { added, removed, changed };
}
