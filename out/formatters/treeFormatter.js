"use strict";
/*
 * treeFormatter.ts — human-readable box-drawing renderer for the canonical scene
 * tree (M3/WU-1: F3.1).
 *
 * `formatTree(root)` walks the same `MinimalNode` tree `buildTree` returns and
 * emits one line per node in an indented box-drawing hierarchy, e.g.:
 *
 *   Layer "RootLayer" #1  [0]  (1920x1080 @ 0,0)
 *   ┠╴ CameraActor "" #2  [0/0]  (0x0 @ 960,540)
 *   ┖╴ FlexLayoutImpl "" #3  [0/1]  (1920x1080 @ 0,0)
 *      ┖╴ LabelImpl "Hello" #4  [0/1/0]  (262x56 @ 829,502)
 *
 * Per line: `Type "name" #mark  [id]  (WxH @ x,y)`. A child that is NOT the last
 * sibling is prefixed `┠╴` and its descendants continue under a `┃ ` rail; the
 * last sibling is prefixed `┖╴` and its descendants continue under a blank rail.
 * This is PURE: a deterministic function of the tree, no fs / process / printing.
 * The CLI (WU-1) prints this for `--format tree`; the report formatter (WU-2)
 * embeds it verbatim.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTree = formatTree;
/** Connector drawn before a non-last child. */
const TEE = '┠╴';
/** Connector drawn before the last child. */
const ELBOW = '┖╴';
/** Continuation rail under a non-last child (a child still follows below). */
const RAIL = '┃ ';
/** Continuation rail under the last child (nothing follows below). */
const BLANK = '  ';
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
/** Render the `(WxH @ x,y)` suffix, or `(no bounds)` when bounds are absent. */
function formatBounds(node) {
    const b = numericBounds(node);
    if (b === null) {
        return '(no bounds)';
    }
    return `(${b.w}x${b.h} @ ${b.x},${b.y})`;
}
/**
 * Render the single descriptive line for one node (without its tree-prefix):
 * `Type "name" #mark  [id]  (WxH @ x,y)`. A truncated node (M3/WU-3) gets a
 * trailing ` …truncated` marker so the box-tree shows where pruning happened.
 */
function formatLine(node) {
    const type = typeof node.type === 'string' ? node.type : '?';
    const name = typeof node.name === 'string' ? node.name : '';
    const mark = typeof node.mark === 'number' ? `#${node.mark}` : '#?';
    const id = typeof node.id === 'string' ? node.id : '?';
    const base = `${type} "${name}" ${mark}  [${id}]  ${formatBounds(node)}`;
    return node.truncated === true ? `${base}  …truncated` : base;
}
/** Real (object) children of a node, in array order; [] when none. */
function childrenOf(node) {
    const children = node.children;
    if (!Array.isArray(children)) {
        return [];
    }
    return children.filter((c) => c !== null && typeof c === 'object');
}
/**
 * Append `node`'s box-drawing line and recurse into its children. `prefix` is the
 * accumulated rail string drawn before this node's connector; `connector` is the
 * `┠╴`/`┖╴` glyph for this node (empty for the root). Children extend `prefix`
 * with a `┃ ` rail (non-last) or blank (last) so the vertical lines line up.
 */
function appendNode(node, prefix, connector, out) {
    out.push(`${prefix}${connector}${formatLine(node)}`);
    const kids = childrenOf(node);
    // The rail under THIS node continues for its children: a non-root non-last
    // child contributes a `┃ ` rail, a last child a blank one.
    const childPrefix = connector === '' ? '' : prefix + (connector === TEE ? RAIL : BLANK);
    for (let i = 0; i < kids.length; i++) {
        const isLast = i === kids.length - 1;
        appendNode(kids[i], childPrefix, isLast ? ELBOW : TEE, out);
    }
}
/**
 * Render the whole tree as a box-drawing hierarchy string (no trailing newline).
 * One line per node, root first; deterministic (child-index order, no re-sort).
 */
function formatTree(root) {
    const out = [];
    appendNode(root, '', '', out);
    return out.join('\n');
}
