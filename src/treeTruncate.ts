/*
 * treeTruncate.ts — token-bounded pruning of the canonical scene tree
 * (M3/WU-3: F3.3).
 *
 * `truncate(root, {maxDepth?, maxNodes?})` returns a DEEP CLONE of the tree with
 * two independent bounds applied so an AI caller can cap the JSON it ingests:
 *
 *   - `maxDepth`  : keep nodes whose depth ≤ maxDepth (root = depth 0). A kept
 *                   node sitting exactly at maxDepth has its children dropped; if
 *                   it actually HAD children, it is stamped `truncated: true`.
 *   - `maxNodes`  : a pre-order emission budget. Nodes are admitted in pre-order
 *                   (parent before children, children in array order) until the
 *                   budget is spent. A parent whose children are wholly/partly
 *                   dropped for lack of budget is stamped `truncated: true`.
 *
 * Both bounds may be combined; either may be omitted (omitted ⇒ unbounded). The
 * function is PURE and DETERMINISTIC: it clones (never mutates the input), keeps
 * the existing child-index order with no re-sort, and the same input + the same
 * options always yields byte-identical output. The clone carries through every
 * harness field (id/type/role/bounds/sourceLine/…) untouched; only `children`
 * and the synthetic `truncated` marker are adjusted.
 */

import { MinimalNode } from './treeModel';

/** Bounds for {@link truncate}; an omitted field means "no limit on that axis". */
export interface TruncateOptions {
    /** Max node depth to keep (root = 0). Omit / non-finite ⇒ unbounded depth. */
    maxDepth?: number;
    /** Max total nodes to emit (pre-order budget). Omit / non-finite ⇒ unbounded. */
    maxNodes?: number;
}

/** Real (object) children of a node, in array order; [] when none. */
function childrenOf(node: MinimalNode): MinimalNode[] {
    const children = node.children;
    if (!Array.isArray(children)) {
        return [];
    }
    return children.filter(
        (c): c is MinimalNode => c !== null && typeof c === 'object',
    );
}

/**
 * Deep-clone a single node WITHOUT its children (children are rebuilt by the
 * caller after pruning). Every other own enumerable field is structurally cloned
 * so the result shares no references with the input (determinism / no mutation).
 * Any pre-existing `truncated` field on the input is dropped — truncation state
 * is re-derived here, never inherited.
 */
function cloneShallowNode(node: MinimalNode): MinimalNode {
    const clone: MinimalNode = { type: node.type };
    for (const key of Object.keys(node)) {
        if (key === 'children' || key === 'truncated' || key === 'type') {
            continue;
        }
        clone[key] = deepCloneValue(node[key]);
    }
    return clone;
}

/** Structural deep-clone of an arbitrary harness value (objects/arrays/scalars). */
function deepCloneValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((v) => deepCloneValue(v));
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>)) {
            out[key] = deepCloneValue((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}

/** Mutable budget shared across the recursion (pre-order node allowance). */
interface Budget {
    remaining: number;
}

/**
 * Recursively clone `node` (already counted against the budget by the caller),
 * pruning by depth and the shared node budget. Returns the pruned clone. Sets
 * `truncated: true` on the clone when any real child is dropped — whether by the
 * depth cap or by an exhausted budget.
 */
function pruneNode(
    node: MinimalNode,
    depth: number,
    maxDepth: number,
    budget: Budget,
): MinimalNode {
    const clone = cloneShallowNode(node);
    const realChildren = childrenOf(node);

    // Depth cap: at maxDepth we keep this node but none of its children.
    if (depth >= maxDepth) {
        if (realChildren.length > 0) {
            clone.truncated = true;
        }
        return clone;
    }

    const keptChildren: MinimalNode[] = [];
    let droppedAny = false;
    for (const child of realChildren) {
        if (budget.remaining <= 0) {
            droppedAny = true;
            // Stop scanning once the budget is spent; remaining siblings are
            // dropped (and recorded as a truncation on this parent).
            break;
        }
        budget.remaining -= 1;
        keptChildren.push(pruneNode(child, depth + 1, maxDepth, budget));
    }

    if (keptChildren.length > 0) {
        clone.children = keptChildren;
    }
    if (droppedAny) {
        clone.truncated = true;
    }
    return clone;
}

/**
 * Return a deep-cloned, depth-/count-bounded copy of `root`. Omitted limits are
 * treated as unbounded. The root always counts as the first emitted node, so a
 * `maxNodes` of 0 or 1 still yields the root alone (with `truncated: true` when
 * it had children). Never mutates the input.
 *
 * @param root  The canonical tree root (from `buildTree`).
 * @param opts  `{maxDepth?, maxNodes?}`; each omitted ⇒ no limit on that axis.
 * @returns     A new pruned tree; deterministic for a given (root, opts) pair.
 */
export function truncate(root: MinimalNode, opts: TruncateOptions = {}): MinimalNode {
    const maxDepth =
        typeof opts.maxDepth === 'number' && Number.isFinite(opts.maxDepth)
            ? Math.max(0, Math.floor(opts.maxDepth))
            : Infinity;
    const maxNodes =
        typeof opts.maxNodes === 'number' && Number.isFinite(opts.maxNodes)
            ? Math.max(1, Math.floor(opts.maxNodes))
            : Infinity;

    // The root consumes the first unit of the budget; children draw from the rest.
    const budget: Budget = { remaining: maxNodes - 1 };
    return pruneNode(root, 0, maxDepth, budget);
}
