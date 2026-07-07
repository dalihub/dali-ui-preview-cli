"use strict";
/**
 * Preview source transforms shared with the VS Code extension (port of
 * codeExtractor.sanitizeUnsupportedGlyphs + transformVectorChildren). Applied to
 * resolved preview code before templating, because the CLI renders in the SAME
 * docker image: DejaVu-only fonts (emoji have no glyph) and View::AddChildren only
 * accepts an initializer_list. Both transforms preserve line count, so any
 * line-based mapping (userCodeOffset / click-to-code) stays valid.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeUnsupportedGlyphs = sanitizeUnsupportedGlyphs;
exports.transformVectorChildren = transformVectorChildren;
exports.applyPreviewTransforms = applyPreviewTransforms;
/**
 * Replace emoji/pictograph chars that have no glyph in the preview runtime font
 * with □, inside string literals only. Without this, several emoji spread across
 * separate Labels abort DALi (free(): invalid pointer) in the DejaVu-only image.
 * Box-drawing / geometric / degree (━ ● ▮ °) render fine and are kept.
 */
function sanitizeUnsupportedGlyphs(code) {
    let replaced = false;
    const out = code.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (full, inner) => {
        const fixed = inner.replace(/[\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FAFF}]/gu, '□');
        if (fixed !== inner) {
            replaced = true;
            return '"' + fixed + '"';
        }
        return full;
    });
    return { code: out, replaced };
}
/**
 * Rewrite `EXPR.AddChildren(vec)` / `EXPR.Children(vec)` — where vec is a single
 * identifier (a std::vector<View>), not an `{ init-list }` — into code that
 * .Add()s each element. View::AddChildren (renamed from Children when dali-ui
 * dropped the fluent API) has only an initializer_list overload, so passing a
 * vector won't compile; this is the source transform for that case. An `{ ... }`
 * argument is left untouched (it already compiles). The legacy `Children` name
 * is still matched so pre-migration snippets keep working.
 */
function transformVectorChildren(code) {
    return code
        // Non-fluent statement form (the post-fluent-removal idiom):
        //   `root.AddChildren(items);`  ->  `for (auto& __ce : items) { root.Add(__ce); }`
        // Matches only a bare-identifier receiver and a single-identifier (vector)
        // argument — an `{ init-list }` argument starts with `{` and is left alone.
        .replace(/(^|\n)([ \t]*)([A-Za-z_]\w*)\.(?:Add)?Children\(\s*([A-Za-z_]\w*)\s*\)\s*;/g, (_m, pre, indent, recv, vec) => `${pre}${indent}for (auto& __ce : ${vec}) { ${recv}.Add(__ce); }`)
        // Legacy fluent return-expression form (pre-migration snippets):
        //   `return EXPR.Children(items);`  ->  IIFE that .Add()s each element.
        .replace(/\breturn\s+([\s\S]+?)\.(?:Add)?Children\(\s*([A-Za-z_]\w*)\s*\)\s*;/g, (_m, expr, vec) => `return [&]{ auto __cw = ${expr}; for (auto& __ce : ${vec}) { __cw.Add(__ce); } return __cw; }();`);
}
/** Apply both transforms; returns whether any emoji were replaced (for a warning). */
function applyPreviewTransforms(code) {
    const sanitized = sanitizeUnsupportedGlyphs(code);
    return { code: transformVectorChildren(sanitized.code), emojiReplaced: sanitized.replaced };
}
