/*
 * treeModel.ts — parse the harness-produced scene metadata JSON into the minimal
 * node tree the CLI prints to stdout (M0/WU-5).
 *
 * M0 schema is intentionally MINIMAL: each node carries a concrete `type` and a
 * `children` array (per F0.4). The rich canonical schema (stable ids, semantic
 * role, frame-accurate bounds via CalculateCurrentScreenExtents) is M1.
 *
 * The harness `ExportSceneMetadata` emits `{ "root": { name:"RootLayer", x,y,w,h,
 * children:[...] } }`. Every actor child already carries a concrete `type`
 * (e.g. "FlexLayoutImpl", "LabelImpl", "CameraActor"), but the synthetic `root`
 * node carries only `name` and no `type`. F0.4 requires the emitted root to have
 * a concrete type, so we stamp the root with `type: "Layer"` (it IS the DALi root
 * Layer) when it lacks one — the "always carry the node type" lesson (research.md
 * Godot pitfall). No other transformation is applied in M0.
 */

/** A minimal scene-tree node (M0). Extra harness fields pass through untouched. */
export interface MinimalNode {
    /** Concrete node type (e.g. "Layer", "FlexLayoutImpl", "LabelImpl"). */
    type: string;
    /** Actor name (may be empty; the root is "RootLayer"). */
    name?: string;
    /** Child nodes, in actor child-index order. */
    children?: MinimalNode[];
    /** Other harness-exported fields (x, y, w, h, visible, properties, …). */
    [key: string]: unknown;
}

/**
 * Parse the harness scene-metadata JSON into the minimal node tree.
 *
 * @param metadataJson  Raw contents of the harness `tree.json` (from
 *                      `RenderResult.metadataJson`), or null if none was produced.
 * @returns             The root node, guaranteed to carry a concrete `type`.
 * @throws              If `metadataJson` is null/empty, not valid JSON, or has no
 *                      object root node.
 */
export function buildTree(metadataJson: string | null): MinimalNode {
    if (metadataJson === null || metadataJson.trim().length === 0) {
        throw new Error('no scene metadata was produced by the render.');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(metadataJson);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`scene metadata is not valid JSON: ${reason}`);
    }

    // The harness wraps the tree as `{ root: <node> }`; accept a bare node too.
    const wrapper = parsed as { root?: unknown };
    const rootRaw =
        wrapper !== null && typeof wrapper === 'object' && wrapper.root !== undefined
            ? wrapper.root
            : parsed;

    if (rootRaw === null || typeof rootRaw !== 'object') {
        throw new Error('scene metadata has no object root node.');
    }

    const root = rootRaw as MinimalNode;

    // Stamp a concrete type on the synthetic RootLayer node (F0.4: every node,
    // including the root, must carry a concrete type — never name-only).
    if (typeof root.type !== 'string' || root.type.length === 0) {
        root.type = 'Layer';
    }

    return root;
}
