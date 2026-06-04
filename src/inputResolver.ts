/*
 * inputResolver.ts — resolve a CLI input file path to raw preview C++ + a
 * 0-based start line, for the dali-ui-preview CLI (M0/WU-3).
 *
 * Two input shapes are supported in M0:
 *
 *   1. Preview-file mode — a `*.preview.dali.cpp` file whose ENTIRE body is the
 *      preview code (comments + a trailing `return TypeName::New()...;`). The
 *      whole file is the code and `startLine` is 0.
 *
 *   2. Marker mode — a regular `.cpp` / `.h` file with a preview region delimited
 *      by `// @dali-preview-begin` / `// @dali-preview-end` line comments. The
 *      region between the markers (exclusive) is the code, and `startLine` is the
 *      0-based index of the first line AFTER the begin marker.
 *
 * stdin / inline-snippet modes are out of scope for M0 (later milestones).
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
    mode: 'preview-file' | 'marker';
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
            throw new Error(
                `No preview region found in '${filePath}': expected a ` +
                `'${MARKER_BEGIN}' / '${MARKER_END}' marker pair with code between them.`,
            );
        }

        // Lines strictly between the two markers (markers excluded).
        const code = lines.slice(beginLine + 1, endLine).join('\n');
        return {
            code,
            startLine: beginLine + 1,
            mode: 'marker',
            sourcePath: filePath,
        };
    }

    throw new Error(
        `Unsupported input '${filePath}': expected a '*${PREVIEW_FILE_SUFFIX}' file ` +
        `or a '.cpp' / '.h' file with '${MARKER_BEGIN}' / '${MARKER_END}' markers.`,
    );
}
