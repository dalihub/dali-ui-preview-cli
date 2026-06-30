/**
 * sliceBuilder.ts — Rung 2 (heuristic, same-file) slice extraction.
 *
 * Turns a preview-target function that references same-file helpers / namespace
 * constants / unresolved members into a SELF-CONTAINED translation unit, so the
 * dlopen compile path can build it.
 *
 *   Rung 3 (single-fn): the target references nothing project-local → passthrough,
 *                       empty slots → byte-identical to today (regression floor).
 *   Rung 2 (heuristic): collect same-file definitions into the globals slot,
 *                       auto-stub whatever stays unresolved (members/externs).
 *
 * Cross-file resolution (helpers in another .cpp) is Rung 1 (clangd) and is out
 * of scope here — those references fall through to weak stubs and are reported.
 *
 * Zero deps: regex + brace matching on the raw source. See ADR-003.
 */

export interface SliceResult {
    /** Hoisted #include lines (may be ''). Goes above globals. */
    includes: string;
    /** Collected helper/type/const defs + weak stubs, topo-ordered (may be ''). */
    globals: string;
    /** The preview-target function body (never empty). */
    body: string;
    /** Source files to attribute #line errors to. [0]=entry, then helper sources. */
    sourcePaths: string[];
    /** Identifiers filled by weak stubs (for diagnostics / the validation matrix). */
    unresolvedStubs: string[];
    /** Rung3 passthrough vs Rung2 heuristic slice. */
    rung: 'single-fn' | 'heuristic';
    /** Names of collected View-returning helpers, so instrumentCode can __tag their
     *  calls too (a cross-file MakeSectionHeader(...) → click-to-code). */
    helpers: string[];
}

// dali-ui / std symbols that arrive via the template's #includes — never collected
// or stubbed. Builder methods (.SetX, .New) are filtered separately (preceded by '.').
const KNOWN_SYMBOLS = new Set([
    // widget / layout types
    'View', 'Label', 'TextLabel', 'ImageView', 'FlexLayout', 'StackLayout',
    'GridLayout', 'AbsoluteLayout', 'Actor', 'Layer', 'Window', 'Application',
    'StackLayoutParams', 'FlexLayoutParams', 'GridLayoutParams', 'AbsoluteLayoutParams',
    // value types
    'UiColor', 'Extents', 'Vector2', 'Vector3', 'Vector4', 'Color', 'Property',
    'Dali', 'Ui', 'String',
    // enums + constants
    'FlexDirection', 'FlexJustify', 'FlexAlign', 'FlexWrap', 'StackOrientation',
    'MATCH_PARENT', 'WRAP_CONTENT', 'COLUMN', 'ROW', 'CENTER',
    // std
    'std', 'string', 'vector', 'to_string', 'size_t', 'uint32_t', 'int32_t',
    // our injected helper
    '__tag',
]);

// C++ keywords that are never identifiers we resolve.
const KEYWORDS = new Set([
    'return', 'auto', 'const', 'constexpr', 'static', 'void', 'int', 'float',
    'double', 'bool', 'char', 'unsigned', 'signed', 'long', 'short', 'for',
    'while', 'if', 'else', 'do', 'switch', 'case', 'break', 'continue', 'true',
    'false', 'nullptr', 'new', 'delete', 'class', 'struct', 'namespace', 'using',
    'public', 'private', 'protected', 'this', 'sizeof', 'typename', 'template',
]);

/** Find the index of the '}' matching the '{' at openIdx, skipping strings/comments. */
function matchBrace(src: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') { i++; } continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) { i++; } i++; continue; }
        if (c === '"' || c === '\'') {
            const q = c; i++;
            while (i < src.length && src[i] !== q) { if (src[i] === '\\') { i++; } i++; }
            continue;
        }
        if (c === '{') { depth++; }
        else if (c === '}') { depth--; if (depth === 0) { return i; } }
    }
    return -1;
}

/** 0-based line number of a character offset. */
function lineOf(src: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < src.length; i++) { if (src[i] === '\n') { line++; } }
    return line;
}

/**
 * Emit a `#line N "path"` preprocessing directive (WU-M4.5). `#line N "f"` tells
 * the compiler "the NEXT source line is line N of file f", so a def collected from
 * its original 0-based `line` L is preceded by `#line L+1 "path"` — then g++ reports
 * any error inside that def at its REAL file:line (not the generated harness line).
 * #line is STANDARD and semantically INERT: it relabels diagnostics only, never the
 * compiled/rendered output. The path is emitted as a C string literal (backslashes
 * and quotes escaped) so a Windows-style path or an odd character can't break it.
 */
function lineDirective(line0Based: number, srcPath: string): string {
    const escaped = srcPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `#line ${line0Based + 1} "${escaped}"`;
}

interface PreviewFn {
    body: string;       // inside the outer braces (no surrounding { })
    bodyLine: number;   // 0-based line where the body starts
    fnName: string;
    params: { name: string; type: string }[];  // signature params (for precise stubbing)
}

/** Parse a parameter list ("const char* text, int n") into {type, name} pairs. */
function parseParams(paramStr: string): { name: string; type: string }[] {
    return paramStr.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
        // The last identifier is the parameter name; everything before it is the type.
        const m = p.match(/^(.*?)\b([A-Za-z_]\w*)\s*$/);
        return m ? { type: m[1].trim(), name: m[2] } : null;
    }).filter((p): p is { name: string; type: string } => p !== null);
}

/**
 * Locate the preview target: the function whose body follows a `// @preview`
 * marker (or, lacking one, the first View/Actor-returning function). Returns the
 * body text between its outer braces. Member functions (Class::Build / a method
 * inside a class) are handled the same way — we only need the body.
 */
export function findPreviewFunction(src: string): PreviewFn | null {
    // Prefer a `// @preview` or zero-arg `// @dali-preview` entry marker, so the
    // slice picks the factory function AFTER the marker. The `@dali-preview`
    // alternative excludes the `@dali-preview-begin`/`-end` region markers via a
    // `(?!-)` lookahead (the char after the token must not be `-`); the bare
    // `@preview` alternative is left exactly as before (it still matches
    // `@preview` / `@preview-config` / `@preview-state` the way it always did).
    let searchFrom = 0;
    const marker = src.search(/\/\/\s*@preview\b|\/\/\s*@dali-preview\b(?!-)/);
    if (marker !== -1) { searchFrom = marker; }

    // From searchFrom, find the next function signature `... name(params) {`.
    const sigRe = /([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*(?:const\s*)?\{/g;
    sigRe.lastIndex = searchFrom;
    let m: RegExpExecArray | null;
    while ((m = sigRe.exec(src)) !== null) {
        const name = m[1];
        if (KEYWORDS.has(name)) { continue; }           // skip if(...) / for(...) etc.
        const braceIdx = src.indexOf('{', m.index + m[0].length - 1);
        if (braceIdx === -1) { continue; }
        const close = matchBrace(src, braceIdx);
        if (close === -1) { continue; }
        const body = src.slice(braceIdx + 1, close);
        return { body, bodyLine: lineOf(src, braceIdx + 1), fnName: name, params: parseParams(m[2]) };
    }
    return null;
}

/** Collect candidate identifiers referenced in a body (calls, types, namespaces, vars). */
export function scanRefs(body: string): Set<string> {
    const refs = new Set<string>();
    // Strip strings + comments so identifiers inside them don't count.
    const cleaned = body
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    // Identifiers DECLARED locally in the body (`auto x = …`, range-for vars
    // `for (… & tx : …)`) are not external refs — they're defined right here, so
    // they must never be collected or stubbed (else `auto txList`/`tx` leak into
    // the globals slot as bogus stubs).
    const locals = new Set<string>();
    // `auto x` / `auto& x`
    for (const lm of cleaned.matchAll(/\bauto\b[\s&*]+([A-Za-z_]\w*)/g)) { locals.add(lm[1]); }
    // primitive / std type declarations: `uint32_t colors[]`, `const char* names`, `int i`
    for (const lm of cleaned.matchAll(/\b(?:const\s+|unsigned\s+|signed\s+)*(?:u?int(?:8|16|32|64)?_t|int|float|double|bool|char|short|long|size_t|std::\w+)\b[\s*&]*([A-Za-z_]\w*)\s*[[=;,)]/g)) { locals.add(lm[1]); }
    // for-loop variable: `for (int i = …)` / `for (const auto& x : …)`
    for (const lm of cleaned.matchAll(/\bfor\s*\(\s*(?:const\s+)?[\w:]+\s*[&*]?\s*([A-Za-z_]\w*)\s*[=:]/g)) { locals.add(lm[1]); }
    // Object-type local declarations — the non-fluent dali-ui idiom:
    // `FlexLayout root = …`, `Label title;`, `Dali::Ui::View card(…)`. The type is
    // an (optionally qualified / templated) identifier whose final segment is
    // Capitalized; the declared name is a local, never an external ref. Anchored to
    // statement starts so it never matches member access (`root.Set…`) or factory
    // calls (`Label::New(…)`, `UiColor(…)`), which have no `<type> <name>` shape.
    for (const lm of cleaned.matchAll(/(?:^|[\n;{}])[ \t]*(?:const\s+)?(?:[A-Za-z_]\w*::)*[A-Z]\w*(?:<[^>{};]*>)?[\s&*]+([A-Za-z_]\w*)\s*[=;({]/g)) { locals.add(lm[1]); }

    // Match identifiers NOT preceded by '.' (member access) or ':' (scope member).
    // For `Scope::Member` only the scope head is a resolvable ref — `::Member`
    // (Type::New, theme::ACCENT, FlexAlign::CENTER) is a static/enum/member that
    // resolves through the scope itself, never a free symbol to collect or stub.
    const idRe = /(^|[^.\w:])([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(cleaned)) !== null) {
        const id = m[2];
        if (KEYWORDS.has(id) || KNOWN_SYMBOLS.has(id) || locals.has(id)) { continue; }
        refs.add(id);
    }
    return refs;
}

interface CollectedDef {
    name: string;
    text: string;   // full definition text
    line: number;   // 0-based source line of the definition
    srcPath: string; // absolute path of the file this def came from (for #line)
}

/**
 * For each ref, find its definition in the SAME source and return the def text.
 * Handles: free/static functions, namespaces (`namespace X { ... }`), struct/class,
 * and single-line const/constexpr. Refs with no same-file definition are returned
 * as `unresolved` (members, cross-file helpers, external models).
 */
export function collectSameFileDefs(src: string, refs: Set<string>, excludeRange?: [number, number], srcPath = ''):
    { collected: CollectedDef[]; unresolved: string[] } {
    const collected: CollectedDef[] = [];
    const unresolved: string[] = [];

    for (const name of refs) {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let found: CollectedDef | null = null;

        // 1) namespace X { ... }
        const nsRe = new RegExp(`\\bnamespace\\s+${esc}\\s*\\{`, 'g');
        let nm = nsRe.exec(src);
        if (nm) {
            const brace = src.indexOf('{', nm.index);
            const close = matchBrace(src, brace);
            if (close !== -1) {
                found = { name, text: src.slice(nm.index, close + 1), line: lineOf(src, nm.index), srcPath };
            }
        }

        // 2) struct/class X { ... };
        if (!found) {
            const tyRe = new RegExp(`\\b(?:struct|class)\\s+${esc}\\b[^{;]*\\{`, 'g');
            const tm = tyRe.exec(src);
            if (tm) {
                const brace = src.indexOf('{', tm.index);
                const close = matchBrace(src, brace);
                if (close !== -1) {
                    // include trailing ';'
                    let end = close + 1;
                    if (src[end] === ';') { end++; }
                    found = { name, text: src.slice(tm.index, end), line: lineOf(src, tm.index), srcPath };
                }
            }
        }

        // 3) free/static function: `<ret> name(...) { ... }` (not a call site)
        if (!found) {
            const fnRe = new RegExp(`(?:^|\\n)([ \\t]*(?:static\\s+)?[A-Za-z_][\\w:<>,&* ]*?\\b${esc}\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?\\{)`, 'g');
            const fm = fnRe.exec(src);
            if (fm) {
                const sigStart = fm.index + (fm[0].length - fm[1].length);
                const brace = src.indexOf('{', sigStart);
                const close = matchBrace(src, brace);
                if (close !== -1 && (!excludeRange || sigStart < excludeRange[0] || sigStart >= excludeRange[1])) {
                    // Keep the ORIGINAL source line of the (untrimmed) signature start,
                    // not the trimmed text — `#line` must point at the def's real line.
                    found = { name, text: src.slice(sigStart, close + 1).trim(), line: lineOf(src, sigStart), srcPath };
                }
            }
        }

        // 4) single-line const/constexpr: `constexpr T name = ...;`  (handled via namespace usually)
        if (!found) {
            const cRe = new RegExp(`\\b(?:constexpr|const)\\s+[\\w:<>]+\\s+${esc}\\s*=\\s*[^;]+;`, 'g');
            const cm = cRe.exec(src);
            if (cm) {
                found = { name, text: cm[0], line: lineOf(src, cm.index), srcPath };
            }
        }

        if (found) { collected.push(found); }
        else { unresolved.push(name); }
    }
    return { collected, unresolved };
}

/** Heuristically synthesise a weak, bodied stub for an unresolved identifier. */
export function synthWeakStub(name: string, body: string): string {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // View-returning helper: called as `name(...)` and used where a View is expected.
    if (new RegExp(`\\b${esc}\\s*\\(`).test(body)) {
        return `__attribute__((weak)) Dali::Ui::View ${name}(...) { return Dali::Ui::View::New(); }`;
    }
    // Container iterated by a range-for: `for (... : name)`.
    if (new RegExp(`:\\s*${esc}\\b`).test(body) && /for\s*\(/.test(body)) {
        return `static auto ${name} = std::vector<int>{0, 0, 0}; // weak stub: 3 dummy elements`;
    }
    // String context: `.c_str()` on it, or passed where text is expected.
    if (new RegExp(`\\b${esc}\\s*\\.\\s*c_str\\s*\\(`).test(body) || new RegExp(`Label::New\\s*\\(\\s*${esc}\\b`).test(body)) {
        return `__attribute__((weak)) std::string ${name} = "${humanizePlaceholder(name)}";`;
    }
    // Scalar context: used inside UiColor(name) / arithmetic → an unsigned int.
    if (new RegExp(`UiColor\\s*\\(\\s*${esc}\\b`).test(body)) {
        return `__attribute__((weak)) unsigned int ${name} = 0x888888;`;
    }
    // Fallback: a weak int that compiles anywhere it's read as a value.
    return `__attribute__((weak)) unsigned int ${name} = 0;`;
}

/**
 * Synthesise a PRECISE stub for a signature parameter. The declared type is
 * known, so — unlike synthWeakStub which guesses from usage — this gets the type
 * exactly right (a `const char* text` stays `const char*`, not a std::string).
 * Used when the preview target is itself a parameterised helper: it renders with
 * sample arguments (the automated form of Compose's @PreviewParameter).
 */
function synthParamStub(type: string, name: string): string {
    let bare = type.replace(/&/g, '').trim();  // drop reference qualifier
    // A by-value weak global needs external linkage; a leading `const` on a value
    // type (`const std::string`) makes it internal → "weak declaration must be
    // public" link error. A pointer (`const char*`) is fine — the const is on the
    // pointee, not the global itself — so only strip const when there's no `*`.
    if (!bare.includes('*')) { bare = bare.replace(/^const\s+/, ''); }
    if (/char\s*\*|\bstring\b|String/.test(bare)) { return `${bare} ${name} = "${humanizePlaceholder(name)}";`; }
    if (/\bbool\b/.test(bare)) { return `${bare} ${name} = false;`; }
    if (/\b(?:float|double)\b/.test(bare)) { return `${bare} ${name} = 0;`; }
    // An unsigned-int param in UI code is very often a packed colour (0xRRGGBB);
    // default to a visible grey so it shows, not 0 (black, invisible on dark bg).
    if (/\buint\w*\b|\bunsigned\b/.test(bare)) { return `${bare} ${name} = 0x888888;`; }
    if (/\b(?:int|short|long|size_t|signed)\b/.test(bare)) { return `${bare} ${name} = 0;`; }
    return `${bare} ${name}{};`;
}

/**
 * Extract class/struct member-field declarations across the given sources, as a
 * map name → declared type. Used to stub a member referenced by a member-function
 * preview target with its EXACT type (e.g. `mVm` → `WalletViewModel`), rather than
 * a fuzzy usage-based guess. Method bodies are stripped so only top-level field
 * declarations remain; constructors / methods (which have `(`) are ignored.
 */
function parseMemberFields(sources: SourceFile[]): Map<string, string> {
    const fields = new Map<string, string>();
    for (const s of sources) {
        const classRe = /\b(?:class|struct)\s+\w+[^{;]*\{/g;
        let m: RegExpExecArray | null;
        while ((m = classRe.exec(s.text)) !== null) {
            const brace = s.text.indexOf('{', m.index);
            const close = matchBrace(s.text, brace);
            if (close === -1) { continue; }
            // Collapse nested braces (method bodies, brace-initializers) repeatedly
            // so only the class's top-level declarations remain.
            let body = s.text.slice(brace + 1, close);
            let prev = '';
            while (prev !== body) { prev = body; body = body.replace(/\{[^{}]*\}/g, ' '); }
            // `TYPE name;` (optionally `= init`). No `(` → not a method/ctor.
            const fieldRe = /(?:^|[;:}])\s*((?:const\s+)?[\w:]+(?:<[^>]*>)?[\s*&]*?)\s+(\w+)\s*(?:=[^;()]*)?;/g;
            let fm: RegExpExecArray | null;
            while ((fm = fieldRe.exec(body)) !== null) {
                if (!fields.has(fm[2])) { fields.set(fm[2], fm[1].trim()); }
            }
        }
    }
    return fields;
}

/** Reduce a type string to its base type name (strip const/&/*, template args, scope). */
function baseTypeName(type: string): string {
    const cleaned = type.replace(/[&*]/g, ' ').replace(/\bconst\b/g, ' ').trim();
    const last = cleaned.split(/\s+/).pop() ?? '';
    return last.replace(/<.*$/, '').split('::').pop() ?? '';
}

/** Parse a struct definition's top-level fields into {type, name} pairs. */
function parseStructFields(structText: string): { name: string; type: string }[] {
    const brace = structText.indexOf('{');
    if (brace === -1) { return []; }
    // Strip comments first, else `std::string balance;  // e.g. "$3,500"` breaks
    // the next field's match (the trailing comment swallows the separator).
    const body = structText.slice(brace + 1, structText.lastIndexOf('}'))
        .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const fields: { name: string; type: string }[] = [];
    // Split on `;` so each declaration is parsed independently — a single regex
    // walk consumes the separator and skips every other field.
    for (const decl of body.split(';')) {
        const m = decl.trim().match(/^((?:const\s+)?[\w:]+(?:<[^>]*>)?[\s*&]*?)\s+(\w+)\s*(?:=.*)?$/s);
        if (m) { fields.push({ type: m[1].trim(), name: m[2] }); }
    }
    return fields;
}

/**
 * Turn a C++ identifier into a readable placeholder string: drop a Hungarian
 * member/pointer prefix (mTitle→Title, pName→Name), split camelCase and
 * snake_case into words, and Title-Case each. `merchant`→"Merchant",
 * `userName`→"User Name", `m_total_count`→"Total Count". Naming each field after
 * itself (instead of a uniform "Sample") keeps fields visually distinct and makes
 * the preview self-documenting — what design tools approximate with Lorem ipsum,
 * but mapped back to the code. Degenerate names fall back to "Sample".
 */
function humanizePlaceholder(name: string): string {
    let s = (name ?? '').trim()
        // Hungarian member/pointer prefix: mFoo / pName (camel) and m_foo / p_name (snake)
        .replace(/^(?:m|p)(?:_(?=[a-z])|(?=[A-Z]))/, '')
        .replace(/^_+/, '');
    const words = s
        .replace(/[_\-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase → spaced
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) { return 'Sample'; }
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Synthesise a sample aggregate-initialiser for a value of `type`, recursively:
 * strings → a placeholder named after the field (see humanizePlaceholder),
 * numbers → 1, vector<T> → three sample T's, a project-local struct → brace-init
 * of its fields. This is P6 — the preview shows SAMPLE data for an injected model
 * the real app would populate from a repository/network. `fieldName` is the name
 * of the field this value initialises (threaded so string placeholders read as
 * "Merchant"/"Amount" rather than a uniform "Sample").
 */
function synthSampleInit(type: string, structDefs: Map<string, string>, depth: number, fieldName?: string): string {
    if (depth > 4) { return '{}'; }
    const bare = type.replace(/[&]/g, '').replace(/^const\s+/, '').trim();
    if (/char\s*\*|\bstring\b|String/.test(bare)) { return `"${fieldName ? humanizePlaceholder(fieldName) : 'Sample'}"`; }
    if (/\bbool\b/.test(bare)) { return 'true'; }
    if (/\b(?:float|double)\b/.test(bare)) { return '1'; }
    if (/\b(?:u?int\w*|short|long|size_t|unsigned|signed)\b/.test(bare)) { return '1'; }
    const vec = bare.match(/vector\s*<\s*(.+)\s*>/);
    if (vec) {
        const el = synthSampleInit(vec[1].trim(), structDefs, depth + 1, fieldName);
        return `{${el}, ${el}, ${el}}`;   // three sample rows so a for-loop renders
    }
    const tn = baseTypeName(bare);
    if (structDefs.has(tn)) {
        const fields = parseStructFields(structDefs.get(tn)!);
        return `${tn}{${fields.map((f) => synthSampleInit(f.type, structDefs, depth + 1, f.name)).join(', ')}}`;
    }
    return '{}';
}

/** Topologically order collected defs (constants/types/namespaces before functions). */
function orderDefs(defs: CollectedDef[]): CollectedDef[] {
    // Simple ordering: source order is usually correct (defs precede the preview fn);
    // sort by original line so a helper that uses an earlier const stays after it.
    return [...defs].sort((a, b) => a.line - b.line);
}

/** A project source file (header or .cpp) to resolve cross-file refs from. */
export interface SourceFile { path: string; text: string; }

/**
 * Build a self-contained slice from a full source file.
 *
 * @param src          full text of the source file
 * @param entrySrcPath path to the file (for #line / sourcePaths)
 * @param entryBody    pre-extracted preview body (orchestrator passes instrumented)
 * @param extraSources #include'd project sources for cross-file (Rung1) resolution
 */
export function buildSlice(src: string, entrySrcPath: string, entryBody?: string, extraSources: SourceFile[] = [], entryParams?: { name: string; type: string }[]): SliceResult {
    // Prefer the already-extracted (and possibly instrumented) preview body the
    // orchestrator passes in; standalone use / tests locate it in `src` instead.
    // entryParams (from a CodeLens targeting a specific fn) wins over the first-fn guess.
    const located = findPreviewFunction(src);
    const entry = entryBody !== undefined
        ? { body: entryBody, params: entryParams ?? located?.params ?? [], bodyLine: located?.bodyLine ?? 0 }
        : located;
    if (!entry) {
        // Nothing to slice — treat the whole input as the body (Rung3 passthrough).
        return { includes: '', globals: '', body: src, sourcePaths: [entrySrcPath], unresolvedStubs: [], rung: 'single-fn', helpers: [] };
    }

    const refs = scanRefs(entry.body);
    // Signature parameters are stubbed precisely from their declared type — drop
    // them from the unresolved refs so they don't get a fuzzy (wrong-type) stub.
    for (const p of entry.params) { refs.delete(p.name); }
    if (refs.size === 0 && entry.params.length === 0) {
        return { includes: '', globals: '', body: entry.body, sourcePaths: [entrySrcPath], unresolvedStubs: [], rung: 'single-fn', helpers: [] };
    }

    // Member fields (for a member-function preview target like Class::Build()):
    // stub a referenced member with its EXACT declared type from the class
    // declaration. If that type is a project-local struct/class, add it to refs so
    // its definition gets collected too. Scalar/string members fall through to the
    // context-based weak stub (which colours/sizes better than a default value).
    const allSources: SourceFile[] = [{ path: entrySrcPath, text: src }, ...extraSources];
    const memberFields = parseMemberFields(allSources);
    const memberRefs: { name: string; type: string }[] = [];
    for (const r of [...refs]) {
        const mtype = memberFields.get(r);
        if (!mtype) { continue; }
        const tn = baseTypeName(mtype);
        if (tn && !KNOWN_SYMBOLS.has(tn) && !KEYWORDS.has(tn)) {
            memberRefs.push({ name: r, type: mtype });
            refs.delete(r);
            refs.add(tn);   // collect the struct/class definition below (+ its sample data)
        }
    }

    let { collected, unresolved } = collectSameFileDefs(src, refs, undefined, entrySrcPath);
    const sourcePaths = [entrySrcPath];

    // Rung1 (heuristic cross-file): resolve the refs still unresolved after the
    // same-file pass from the #include'd project sources (headers + their .cpp),
    // applying the same brace-matching collector to each. Collected defs are
    // inlined into the globals slot — no header mount needed (ADR-006).
    for (const extra of extraSources) {
        if (unresolved.length === 0) { break; }
        const r = collectSameFileDefs(extra.text, new Set(unresolved), undefined, extra.path);
        if (r.collected.length > 0) {
            collected = collected.concat(r.collected);
            sourcePaths.push(extra.path);
        }
        unresolved = r.unresolved;
    }

    // Fixpoint: a collected type can reference further project-local types that
    // aren't in the body's refs — a nested struct (WalletViewModel holds
    // vector<Transaction>). Pull those in too, a few rounds, until nothing new.
    for (let round = 0; round < 4; round++) {
        const have = new Set(collected.map((d) => d.name));
        const more = new Set<string>();
        for (const d of collected) {
            for (const nr of scanRefs(d.text)) {
                if (!have.has(nr) && !KNOWN_SYMBOLS.has(nr)) { more.add(nr); }
            }
        }
        if (more.size === 0) { break; }
        const before = collected.length;
        let rem = more;
        for (const s of allSources) {
            if (rem.size === 0) { break; }
            const rr = collectSameFileDefs(s.text, rem, undefined, s.path);
            for (const d of rr.collected) {
                if (!have.has(d.name)) { collected.push(d); have.add(d.name); }
            }
            rem = new Set(rr.unresolved);
        }
        if (collected.length === before) { break; }   // nothing new → done
    }

    // P6: stub each struct member with SAMPLE data synthesised from its (now
    // collected) struct definition — an empty {} renders blank; this fills
    // strings/numbers and gives vectors a few elements so for-loops produce rows.
    const structDefs = new Map(collected.map((d) => [d.name, d.text]));
    const memberStubs = memberRefs.map((m) =>
        `__attribute__((weak)) ${baseTypeName(m.type)} ${m.name} = ${synthSampleInit(m.type, structDefs, 0, m.name)};`);

    const ordered = orderDefs(collected);
    const includes = ''; // defs inlined into globals rather than mounting headers (ADR-006).

    // Collected defs whose return type is a View/Actor handle are helper factories
    // (MakeSectionHeader, MakeStatCard, ...) — surface their names so instrumentCode
    // tags their CALLS for click-to-code, not just Type::New(...).
    const helpers = ordered
        .filter((d) => /^\s*(?:static\s+)?(?:View|FlexLayout|Control|Label|TextLabel|ImageView|ScrollView|TableView|Actor|StackLayout|GridLayout)\b[^=;]*\(/.test(d.text))
        .map((d) => d.name);

    const paramStubs = entry.params.map((p) => `__attribute__((weak)) ${synthParamStub(p.type, p.name)}`);
    const stubs = unresolved.map((u) => synthWeakStub(u, entry.body));
    // WU-M4.5: prefix each collected def with a `#line` pointing at its ORIGINAL
    // file:line, so a g++ error inside an inlined def (e.g. cards.cpp's MakeStatCard)
    // is reported at cards.cpp:N — not the generated harness line the offset
    // arithmetic could never map back (globals sit ABOVE {{USER_CODE}}). The synthetic
    // stubs (member/param/weak) carry no original source, so they get no directive —
    // they inherit the previous def's labeling, which is harmless (stubs rarely error;
    // #line never changes codegen). Defs with an empty srcPath (no known origin) emit
    // no directive, preserving the existing globals byte-for-byte for that path.
    const globalsParts = [
        ...ordered.map((d) => d.srcPath ? `${lineDirective(d.line, d.srcPath)}\n${d.text}` : d.text),
        ...memberStubs,                  // then member instances of those types
        ...paramStubs,
        ...stubs,
    ];
    const globals = globalsParts.length ? '\n' + globalsParts.join('\n\n') + '\n' : '';

    // Prefix the extracted body with a `#line` pointing at the entry file's body
    // start, so an error in the user's own preview body maps to wallet_screen.cpp:N.
    // (The orchestrator overwrites `body` with the instrumented string for the LIVE
    // path; this keeps the standalone/unit contract honest and the directive is inert.)
    const body = entrySrcPath
        ? `${lineDirective(entry.bodyLine ?? 0, entrySrcPath)}\n${entry.body}`
        : entry.body;

    return {
        includes,
        globals,
        body,
        sourcePaths,
        unresolvedStubs: unresolved,
        rung: 'heuristic',
        helpers,
    };
}
