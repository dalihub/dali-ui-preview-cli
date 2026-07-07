"use strict";
/*
 * treeModel.ts — parse the harness-produced scene metadata JSON into the minimal
 * node tree the CLI prints to stdout (M0/WU-5, extended in M1/WU-2).
 *
 * M0 schema was intentionally MINIMAL: each node carried a concrete `type` and a
 * `children` array (per F0.4). In M1 the harness (WU-1) already emits the rich
 * canonical fields per node — `{ id, type, role, name, bounds{x,y,w,h}, visible,
 * opacity, properties, flexProps?, semanticsSource, children }` — so this module's
 * job shrinks to two light, deterministic projections over that tree:
 *
 *   1. Normalize `semanticsSource`: the harness emits
 *      `"accessible" | "reconstructed"`; F1.1's accepted set is
 *      `{dumptree, reconstructed, bridge}`, so the legacy harness value
 *      `"accessible"` is mapped to `"bridge"`. `"reconstructed"` is left as-is;
 *      an absent value is left absent.
 *   2. Merge `sourceLine` (F1.5): when the caller passes the original `sourceCode`,
 *      it is parsed with `cppParser.parseChainExpression` into the user SceneNode
 *      tree (each node carries a `sourceLine`), and that line is injected into the
 *      matching RUNTIME nodes by a parser↔runtime parallel walk (mirroring
 *      `flexMetadata.mergeNode`). DALi inserts internal `CameraActor` siblings
 *      around the user content, so the anchor is the first non-`CameraActor` child
 *      of the root, and `CameraActor` children are skipped when aligning.
 *
 * The harness `ExportSceneMetadata` wraps the tree as `{ "root": <node> }`. The
 * synthetic `root` node may carry only `name` and no `type`; F0.4 requires the
 * emitted root to have a concrete type, so we stamp it with `type: "Layer"` (it IS
 * the DALi root Layer) when it lacks one. No harness field is stripped or renamed
 * (F1.4 determinism: no reordering, no nondeterministic data).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTree = buildTree;
const cppParser_1 = require("./cppParser");
/** DALi inserts internal CameraActor nodes as siblings of the user's content. */
const CAMERA_ACTOR_TYPE = 'CameraActor';
/**
 * Recursively normalize `semanticsSource` across the whole tree: the harness's
 * `"accessible"` becomes `"bridge"` (F1.1's accepted set is
 * `{dumptree, reconstructed, bridge}`); `"reconstructed"` is left unchanged; an
 * absent value is left absent. Mutates in place (deterministic; no reordering).
 */
function normalizeSemanticsSource(node) {
    if (node.semanticsSource === 'accessible') {
        node.semanticsSource = 'bridge';
    }
    const children = node.children;
    if (Array.isArray(children)) {
        for (const child of children) {
            if (child !== null && typeof child === 'object') {
                normalizeSemanticsSource(child);
            }
        }
    }
}
/**
 * Stamp a stable ordinal `mark` (1-based) on EVERY node in ONE deterministic
 * pre-order DFS: visit the node, then recurse `children` in array order. Mutates
 * in place. EVERY node is marked — including internal `CameraActor` nodes — so the
 * marks are a contiguous `1..N` set with no gaps; downstream surfaces (overlay,
 * `--at`, `--node`) filter on `bounds`, not on mark presence (Inv-1: the `mark` is
 * co-assigned with the harness-authored `id` in the single buildTree walk, so the
 * two cannot drift). Determinism (F1.4/Inv-3): the order is the existing
 * child-index order with no re-sort, so the same metadata yields identical marks.
 *
 * Mirrors `normalizeSemanticsSource`'s null/array guards. The counter is held in a
 * closed-over box so the recursion shares one generator.
 */
function assignMarks(root) {
    const counter = { next: 1 };
    const walk = (node) => {
        node.mark = counter.next++;
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
 * Walk the parser SceneNode tree and the runtime subtree in parallel, matching
 * children positionally (mirroring `flexMetadata.mergeNode`). On the RUNTIME side
 * the internal `CameraActor` children are SKIPPED so that only the user's content
 * children align to the parser's children. The matched runtime node receives the
 * 1-BASED absolute source line `parserNode.sourceLine + startLine + 1`.
 *
 * The parser emits a 0-based line and `startLine` is a 0-based file offset; the
 * public `sourceLine` contract is 1-based (a node on file line 21 reports `21`),
 * so the `+1` is applied HERE, at the output boundary, leaving the parser's
 * internal 0-based emission unchanged.
 *
 * On any count divergence, only what aligns is merged and the rest is left
 * untouched — this never throws.
 */
function mergeSourceLine(runtime, parser, startLine) {
    if (typeof parser.sourceLine === 'number') {
        runtime.sourceLine = parser.sourceLine + startLine + 1;
    }
    const runtimeChildren = Array.isArray(runtime.children) ? runtime.children : [];
    const parserChildren = Array.isArray(parser.children) ? parser.children : [];
    // Align only non-camera runtime children to the parser's children, positionally.
    let parserIdx = 0;
    for (const runtimeChild of runtimeChildren) {
        if (runtimeChild === null || typeof runtimeChild !== 'object') {
            continue;
        }
        if (runtimeChild.type === CAMERA_ACTOR_TYPE) {
            continue;
        }
        if (parserIdx >= parserChildren.length) {
            break;
        }
        mergeSourceLine(runtimeChild, parserChildren[parserIdx], startLine);
        parserIdx++;
    }
}
/**
 * Parse the harness scene-metadata JSON into the canonical node tree, optionally
 * enriching it with parser-derived `sourceLine` provenance (F1.5).
 *
 * @param metadataJson  Raw contents of the harness `tree.json` (from
 *                      `RenderResult.metadataJson`), or null if none was produced.
 * @param opts          Optional enrichment inputs:
 *                      - `sourceCode`: the original C++ preview source; when
 *                        provided (and parseable), each matched runtime node gets a
 *                        `sourceLine`. Skipped silently when absent or unparseable.
 *                      - `startLine`: absolute 0-based offset of `sourceCode` in its
 *                        file, added to each parser `sourceLine`. Defaults to 0.
 * @returns             The root node, guaranteed to carry a concrete `type`. All
 *                      harness fields (id/type/role/bounds/…) pass through intact.
 * @throws              If `metadataJson` is null/empty, not valid JSON, or has no
 *                      object root node.
 */
function buildTree(metadataJson, opts) {
    if (metadataJson === null || metadataJson.trim().length === 0) {
        throw new Error('no scene metadata was produced by the render.');
    }
    let parsed;
    try {
        parsed = JSON.parse(metadataJson);
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`scene metadata is not valid JSON: ${reason}`);
    }
    // The harness wraps the tree as `{ root: <node> }`; accept a bare node too.
    const wrapper = parsed;
    const rootRaw = wrapper !== null && typeof wrapper === 'object' && wrapper.root !== undefined
        ? wrapper.root
        : parsed;
    if (rootRaw === null || typeof rootRaw !== 'object') {
        throw new Error('scene metadata has no object root node.');
    }
    const root = rootRaw;
    // Stamp a concrete type on the synthetic RootLayer node (F0.4: every node,
    // including the root, must carry a concrete type — never name-only).
    if (typeof root.type !== 'string' || root.type.length === 0) {
        root.type = 'Layer';
    }
    // F1.1: normalize the harness's `"accessible"` semanticsSource → `"bridge"`
    // across the whole tree (leave `"reconstructed"`/absent as-is).
    normalizeSemanticsSource(root);
    // F2.2 / Inv-1: stamp a stable ordinal `mark` on every node in this SAME
    // single DFS pass — once, here, after normalization and before the return —
    // so the returned tree (the one source every formatter and the overlay read)
    // already carries marks. No second `mark` generator exists.
    assignMarks(root);
    // F1.5: inject parser-derived sourceLine into the runtime user-subtree.
    if (opts !== undefined && typeof opts.sourceCode === 'string') {
        const scene = (0, cppParser_1.parseChainExpression)(opts.sourceCode);
        if (scene !== null) {
            const userRoot = findUserRoot(root);
            if (userRoot !== undefined) {
                mergeSourceLine(userRoot, scene, opts.startLine ?? 0);
            }
        }
    }
    return root;
}
/**
 * Find the runtime USER-root: the first child of `root` whose type is NOT
 * `CameraActor`. DALi inserts internal CameraActor nodes as siblings of the user's
 * content, so the parser tree's root corresponds to this node — not necessarily
 * `root.children[0]`, which is often a CameraActor. Returns undefined if `root` has
 * no non-camera child.
 */
function findUserRoot(root) {
    const children = root.children;
    if (!Array.isArray(children)) {
        return undefined;
    }
    for (const child of children) {
        if (child !== null && typeof child === 'object' && child.type !== CAMERA_ACTOR_TYPE) {
            return child;
        }
    }
    return undefined;
}
