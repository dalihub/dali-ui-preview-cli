"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// VENDORED from paperclip (DALi Preview VS Code extension) for the dali-ui-preview
// CLI — copied for a self-contained release (ADR-007, M0/WU-2). Behavior unchanged.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * flexMetadata.ts — Merge parser-derived FlexLayout properties into runtime metadata
 *
 * The C++ harness CollectActorMetadata() exports positions/sizes/colors but not
 * FlexLayout-specific properties (direction, alignItems, etc.).
 * The TypeScript parser (cppParser.ts) captures these from the source code.
 *
 * This module walks both trees in DFS order and injects FlexLayout properties
 * from the parser tree into the matching runtime metadata nodes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichMetadataWithFlexProps = enrichMetadataWithFlexProps;
/** Known DALi layout policy constants (non-numeric SetRequestedWidth/Height args). */
const LAYOUT_POLICY_CONSTANTS = new Set([
    'MATCH_PARENT',
    'WRAP_CONTENT',
    'FILL_TO_PARENT',
    'FIT_TO_CHILDREN',
]);
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const FLEX_PROP_KEYS = new Set(['Direction', 'AlignItems', 'JustifyContent', 'Wrap']);
/**
 * Extract the short enum value from a C++ qualified name.
 * "FlexDirection::COLUMN" → "COLUMN", "FlexAlign::CENTER" → "CENTER"
 */
function normalizeEnumValue(val) {
    const idx = val.lastIndexOf('::');
    return idx >= 0 ? val.slice(idx + 2) : val;
}
/**
 * Collect FlexLayout-specific properties from a parser SceneNode.
 * Returns undefined if the node has no flex properties.
 */
function collectFlexProps(node) {
    let direction = 'ROW';
    let alignItems = 'STRETCH';
    let justifyContent = 'FLEX_START';
    let wrap = 'NO_WRAP';
    let hasAny = false;
    for (const [key, vals] of Object.entries(node.properties)) {
        if (!FLEX_PROP_KEYS.has(key) || vals.length === 0) {
            continue;
        }
        const val = normalizeEnumValue(vals[0]);
        switch (key) {
            case 'Direction':
                direction = val;
                hasAny = true;
                break;
            case 'AlignItems':
                alignItems = val;
                hasAny = true;
                break;
            case 'JustifyContent':
                justifyContent = val;
                hasAny = true;
                break;
            case 'Wrap':
                wrap = val;
                hasAny = true;
                break;
        }
    }
    // Only inject flexProps if the node IS a FlexLayout (by type name)
    // or if it has explicit flex property calls
    if (!hasAny && node.type !== 'FlexLayout') {
        return undefined;
    }
    if (node.type === 'FlexLayout') {
        return { direction, alignItems, justifyContent, wrap };
    }
    return { direction, alignItems, justifyContent, wrap };
}
/**
 * Walk runtime node and parser node trees in parallel (DFS), injecting
 * flexProps from the parser tree into matching runtime nodes.
 *
 * Children are matched positionally. If counts differ, extra runtime
 * children are left untouched.
 */
/**
 * Extract a layout policy string from a SetRequestedWidth/Height argument.
 * Returns the policy constant if it is a known symbol, otherwise undefined
 * (meaning the dimension is a numeric literal and needs no policy label).
 */
function extractLayoutPolicy(args) {
    if (!args || args.length === 0) {
        return undefined;
    }
    const arg = args[0].trim();
    return LAYOUT_POLICY_CONSTANTS.has(arg) ? arg : undefined;
}
function mergeNode(runtime, parser) {
    const flexProps = collectFlexProps(parser);
    if (flexProps) {
        runtime.flexProps = flexProps;
    }
    const widthPolicy = extractLayoutPolicy(parser.properties['SetRequestedWidth']);
    if (widthPolicy !== undefined) {
        runtime.widthPolicy = widthPolicy;
    }
    const heightPolicy = extractLayoutPolicy(parser.properties['SetRequestedHeight']);
    if (heightPolicy !== undefined) {
        runtime.heightPolicy = heightPolicy;
    }
    const rChildren = runtime.children ?? [];
    const pChildren = parser.children ?? [];
    const count = Math.min(rChildren.length, pChildren.length);
    for (let i = 0; i < count; i++) {
        mergeNode(rChildren[i], pChildren[i]);
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Enrich runtime metadata with FlexLayout properties extracted from the
 * TypeScript parser tree.
 *
 * The metadata object is mutated in-place and also returned.
 * Safe to call with null/undefined scene — returns metadata unchanged.
 */
function enrichMetadataWithFlexProps(metadata, scene) {
    if (!scene) {
        return metadata;
    }
    const root = metadata.root;
    if (!root || !root.children || root.children.length === 0) {
        return metadata;
    }
    // parser root corresponds to the first user-created child of RootLayer
    mergeNode(root.children[0], scene);
    return metadata;
}
