/**
 * Preview source transforms shared with the VS Code extension (port of
 * codeExtractor.sanitizeUnsupportedGlyphs + transformVectorChildren). Applied to
 * resolved preview code before templating, because the CLI renders in the SAME
 * docker image: DejaVu-only fonts (emoji have no glyph) and View::Children only
 * accepts an initializer_list. Both transforms preserve line count, so any
 * line-based mapping (userCodeOffset / click-to-code) stays valid.
 */

/**
 * Replace emoji/pictograph chars that have no glyph in the preview runtime font
 * with □, inside string literals only. Without this, several emoji spread across
 * separate Labels abort DALi (free(): invalid pointer) in the DejaVu-only image.
 * Box-drawing / geometric / degree (━ ● ▮ °) render fine and are kept.
 */
export function sanitizeUnsupportedGlyphs(code: string): { code: string; replaced: boolean } {
    let replaced = false;
    const out = code.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (full, inner) => {
        const fixed = inner.replace(/[\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FAFF}]/gu, '□');
        if (fixed !== inner) { replaced = true; return '"' + fixed + '"'; }
        return full;
    });
    return { code: out, replaced };
}

/**
 * Rewrite `EXPR.Children(vec)` — where vec is a bare identifier (a
 * std::vector<View>), not an `{ init-list }` — into an IIFE that .Add()s each
 * element. View::Children has only an initializer_list overload, so a vector
 * won't compile. An `{ ... }` argument is left untouched.
 */
export function transformVectorChildren(code: string): string {
    return code.replace(
        /\breturn\s+([\s\S]+?)\.Children\(\s*([A-Za-z_]\w*)\s*\)\s*;/g,
        (_m, expr, vec) => `return [&]{ auto __cw = ${expr}; for (auto& __ce : ${vec}) { __cw.Add(__ce); } return __cw; }();`,
    );
}

/** Apply both transforms; returns whether any emoji were replaced (for a warning). */
export function applyPreviewTransforms(code: string): { code: string; emojiReplaced: boolean } {
    const sanitized = sanitizeUnsupportedGlyphs(code);
    return { code: transformVectorChildren(sanitized.code), emojiReplaced: sanitized.replaced };
}
