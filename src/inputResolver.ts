/*
 * inputResolver.ts — resolve CLI input to raw preview C++ + a 0-based start
 * line, for the dali-ui-preview CLI (M1/WU-3).
 *
 * Four input shapes are supported:
 *
 *   1. Preview-file mode — a `*.preview.dali.cpp` file whose ENTIRE body is the
 *      preview code (comments + a trailing `return TypeName::New()...;`). The
 *      whole file is the code and `startLine` is 0.
 *
 *   2. Marker mode — a regular `.cpp` / `.h` file (or a code block) with a
 *      preview region delimited by `// @dali-preview-begin` /
 *      `// @dali-preview-end` line comments. The region between the markers
 *      (exclusive) is the code, and `startLine` is the 0-based index of the
 *      first line AFTER the begin marker.
 *
 *   3. Inline mode — a code block supplied directly (e.g. via `--code`): if it
 *      contains the marker pair the region is extracted (reported as `marker`),
 *      otherwise the whole text is the preview code with `startLine` 0.
 *
 *   4. Stdin mode — the same as inline, but the code block is read from
 *      `process.stdin` (piped). The whole text is the preview code; the source
 *      path is reported as `<stdin>`.
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): stdout is reserved
 * for the machine contract (the JSON node tree), so this module never writes to
 * stdout — diagnostics, if any, go to stderr. Errors are surfaced by throwing.
 */

import * as fs from 'fs';

/** Result of resolving a CLI input file path to preview code. */
export interface ResolvedInput {
    /** The raw preview C++ (verbatim), ready to feed the harness templater. */
    code: string;
    /**
     * 0-based line index in `sourcePath` where `code` begins. Propagated into
     * the parser / error mapping so diagnostics point back at the user's file.
     */
    startLine: number;
    /** Which extraction shape matched. */
    mode: 'preview-file' | 'marker' | 'inline' | 'stdin';
    /** Absolute or caller-supplied path of the resolved source file. */
    sourcePath: string;
}

/** A `*.preview.dali.cpp` file is treated as pure preview code. */
const PREVIEW_FILE_SUFFIX = '.preview.dali.cpp';

/** Marker comments delimiting a preview region inside a regular C++ source. */
const MARKER_BEGIN = '// @dali-preview-begin';
const MARKER_END = '// @dali-preview-end';

/**
 * Resolve a CLI input file path to its preview C++ and a 0-based start line.
 *
 * @param filePath  Path to a `*.preview.dali.cpp` file (preview-file mode) or a
 *                  `.cpp` / `.h` file containing a `@dali-preview-begin` /
 *                  `@dali-preview-end` region (marker mode).
 * @returns         The resolved code, its mode, the source path, and `startLine`.
 * @throws          If the file does not exist, is not readable, is not a
 *                  recognised preview input, or contains no valid preview region.
 */
export function resolveInput(filePath: string): ResolvedInput {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot read input file '${filePath}': ${reason}`);
    }

    // --- Mode 1: dedicated preview file — whole body is the preview code ---
    if (filePath.endsWith(PREVIEW_FILE_SUFFIX)) {
        return {
            code: raw,
            startLine: 0,
            mode: 'preview-file',
            sourcePath: filePath,
        };
    }

    // --- Mode 2: marker-delimited region inside a regular .cpp / .h ---
    if (filePath.endsWith('.cpp') || filePath.endsWith('.h')) {
        const region = extractMarkerRegion(raw);
        if (region === null) {
            throw new Error(
                `No preview region found in '${filePath}': expected a ` +
                `'${MARKER_BEGIN}' / '${MARKER_END}' marker pair with code between them.`,
            );
        }
        return {
            code: region.code,
            startLine: region.startLine,
            mode: 'marker',
            sourcePath: filePath,
        };
    }

    throw new Error(
        `Unsupported input '${filePath}': expected a '*${PREVIEW_FILE_SUFFIX}' file ` +
        `or a '.cpp' / '.h' file with '${MARKER_BEGIN}' / '${MARKER_END}' markers.`,
    );
}

/**
 * Extract the first complete `@dali-preview-begin` / `@dali-preview-end` region
 * from `raw`. Returns the code strictly between the markers (markers excluded)
 * and the 0-based index of the first line after the begin marker, or `null` if
 * no complete, non-empty marker pair is present.
 */
function extractMarkerRegion(raw: string): { code: string; startLine: number } | null {
    const lines = raw.split('\n');
    let beginLine = -1;
    let endLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i].trim();
        if (text === MARKER_BEGIN) {
            beginLine = i;
        } else if (text === MARKER_END && beginLine >= 0) {
            endLine = i; // first complete pair wins
            break;
        }
    }

    if (beginLine < 0 || endLine < 0 || endLine <= beginLine + 1) {
        return null;
    }

    // Lines strictly between the two markers (markers excluded).
    return {
        code: lines.slice(beginLine + 1, endLine).join('\n'),
        startLine: beginLine + 1,
    };
}

/**
 * Resolve a code block (supplied inline, e.g. via `--code`) to preview C++ and a
 * 0-based start line. If `code` contains a `@dali-preview-begin` /
 * `@dali-preview-end` marker pair, only that region is used (mode `'marker'`,
 * `startLine` pointing at the first line after the begin marker). Otherwise the
 * ENTIRE text is treated as the preview code (mode `'inline'`, `startLine` 0).
 *
 * Unlike {@link resolveInput} there is no file extension to dispatch on and no
 * filesystem read — the text is the source of truth, so this never throws for an
 * "unsupported" shape (an empty/whitespace block simply becomes empty code and
 * fails later at the harness/render stage, where the diagnostic is meaningful).
 *
 * @param code        The raw preview code block.
 * @param sourcePath  Caller-supplied provenance label for diagnostics
 *                    (defaults to `'<code>'`; the stdin path passes `'<stdin>'`).
 * @returns           The resolved code, its mode, the source label, and `startLine`.
 */
export function resolveFromCode(code: string, sourcePath = '<code>'): ResolvedInput {
    const region = extractMarkerRegion(code);
    if (region !== null) {
        return {
            code: region.code,
            startLine: region.startLine,
            mode: 'marker',
            sourcePath,
        };
    }

    return {
        code,
        startLine: 0,
        mode: 'inline',
        sourcePath,
    };
}

/**
 * Resolve preview code read from standard input (a piped code block). Reads ALL
 * of `process.stdin` to a UTF-8 string, then delegates to {@link resolveFromCode}
 * with the `'<stdin>'` provenance label. The reported mode is `'stdin'` (a
 * marker pair inside the piped text is still extracted — the begin/end region —
 * but the mode stays `'stdin'` so callers can see the input arrived on stdin).
 *
 * @returns  The resolved code, mode `'stdin'`, source `'<stdin>'`, and `startLine`.
 */
export async function resolveFromStdin(): Promise<ResolvedInput> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const resolved = resolveFromCode(text, '<stdin>');
    return { ...resolved, mode: 'stdin' };
}
