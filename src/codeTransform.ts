/**
 * Preview source transforms shared with the VS Code extension (port of
 * codeExtractor.sanitizeUnsupportedGlyphs + transformVectorChildren). Applied to
 * resolved preview code before templating, because the CLI renders in the SAME
 * docker image: DejaVu-only fonts (emoji have no glyph) and View::AddChildren only
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

function isCppSpace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** Index of the delimiter matching `open` at `openIdx` (string-literal aware); -1 if none. */
function matchDelimiter(code: string, openIdx: number, open: string, close: string): number {
    let depth = 0;
    let inStr = false;
    let strCh = '';
    for (let i = openIdx; i < code.length; i++) {
        const ch = code[i];
        if (inStr) {
            if (ch === '\\') { i++; } else if (ch === strCh) { inStr = false; }
            continue;
        }
        if (ch === '"' || ch === '\'') { inStr = true; strCh = ch; continue; }
        if (ch === open) { depth++; } else if (ch === close) { depth--; if (depth === 0) { return i; } }
    }
    return -1;
}

/** Split on commas at nesting depth 0 (string-literal aware). */
function splitTopLevelCommas(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inStr = false;
    let strCh = '';
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (ch === '\\') { i++; } else if (ch === strCh) { inStr = false; }
            continue;
        }
        if (ch === '"' || ch === '\'') { inStr = true; strCh = ch; continue; }
        if (ch === '(' || ch === '{' || ch === '[') { depth++; }
        else if (ch === ')' || ch === '}' || ch === ']') { depth--; }
        else if (ch === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    parts.push(s.slice(start));
    return parts;
}

/**
 * Rewrite `EXPR.AddChildren(...)` / `EXPR.Children(...)` into per-child `.Add()` calls.
 *
 * dali-ui REMOVED the child-adder entirely (measured against 2.5.32.10995:
 * `'class Dali::Ui::FlexLayout' has no member named 'AddChildren'`), so BOTH argument
 * forms must be rewritten — not just the vector one:
 *   `root.AddChildren({a, b});`  ->  `root.Add(a); root.Add(b);`
 *   `root.AddChildren(items);`   ->  `for (auto& __ce : items) { root.Add(__ce); }`
 * The earlier version left `{ init-list }` alone on the assumption that an
 * initializer_list overload survived; it does not, so every sample using the brace
 * form failed to compile (CLI e2e: hello-dali.preview.dali.cpp).
 *
 * MIRROR of the extension's `transformChildAddersToAdd` (harnessCodegen.ts) — the two
 * repos duplicate this shared logic on purpose; fix one, mirror the other (CLAUDE.md
 * three-component sync).
 */
export function transformVectorChildren(code: string): string {
    const CALL_RE = /([A-Za-z_]\w*(?:\s*(?:\.|->)\s*[A-Za-z_]\w*)*)\s*\.\s*(?:Add)?Children\s*\(/g;
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL_RE.exec(code)) !== null) {
        const recv = m[1].replace(/\s+/g, '');
        const openParen = m.index + m[0].length - 1;
        let i = openParen + 1;
        while (i < code.length && isCppSpace(code[i])) { i++; }

        if (code[i] === '{') {
            const braceEnd = matchDelimiter(code, i, '{', '}');
            if (braceEnd < 0) { continue; }
            let j = braceEnd + 1;
            while (j < code.length && isCppSpace(code[j])) { j++; }
            if (code[j] !== ')') { continue; }
            const kids = splitTopLevelCommas(code.slice(i + 1, braceEnd))
                .map((c) => c.trim())
                .filter((c) => c.length > 0);
            const replacement = kids.length ? kids.map((c) => `${recv}.Add(${c});`).join(' ') : '(void)0;';
            let end = j + 1;
            if (code[end] === ';') { end++; }
            out += code.slice(last, m.index) + replacement;
            last = end;
            CALL_RE.lastIndex = end;
        } else {
            const closeParen = matchDelimiter(code, openParen, '(', ')');
            if (closeParen < 0) { continue; }
            const arg = code.slice(openParen + 1, closeParen).trim();
            if (!/^[A-Za-z_]\w*$/.test(arg)) { continue; }
            let end = closeParen + 1;
            if (code[end] === ';') { end++; }
            out += code.slice(last, m.index) + `for (auto& __ce : ${arg}) { ${recv}.Add(__ce); }`;
            last = end;
            CALL_RE.lastIndex = end;
        }
    }
    out += code.slice(last);
    return transformLegacyFluentChildren(out);
}

/** Legacy fluent return-expression form (pre-migration snippets). */
function transformLegacyFluentChildren(code: string): string {
    return code
        // Legacy fluent return-expression form (pre-migration snippets):
        //   `return EXPR.Children(items);`  ->  IIFE that .Add()s each element.
        .replace(
            /\breturn\s+([\s\S]+?)\.(?:Add)?Children\(\s*([A-Za-z_]\w*)\s*\)\s*;/g,
            (_m, expr, vec) => `return [&]{ auto __cw = ${expr}; for (auto& __ce : ${vec}) { __cw.Add(__ce); } return __cw; }();`,
        );
}

/** Apply both transforms; returns whether any emoji were replaced (for a warning). */
export function applyPreviewTransforms(code: string): { code: string; emojiReplaced: boolean } {
    const sanitized = sanitizeUnsupportedGlyphs(code);
    return { code: transformVectorChildren(sanitized.code), emojiReplaced: sanitized.replaced };
}
