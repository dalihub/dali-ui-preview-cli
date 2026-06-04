// ─────────────────────────────────────────────────────────────────────────────
// VENDORED from paperclip src/errorParser.ts for the dali-ui-preview CLI (ADR-007, M0/WU-2).
// vscode dependency STRIPPED: removed `import * as vscode` and the `errorsToDiagnostics`
// VS Code Diagnostic adapter. Kept verbatim: parseGccErrors, getHarnessCodeOffset,
// getPluginCodeOffset, formatRawError, formatErrorsForDisplay, the ParsedError interface.
// Not yet wired into CLI output (that is M5). Logic otherwise unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedError {
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning' | 'note';
}

/**
 * Regex for a GCC diagnostic line:
 *   filename:LINE:COLUMN: error|warning|note: MESSAGE
 *
 * We capture: (1) filename, (2) line, (3) column, (4) severity, (5) message.
 */
const GCC_DIAG_RE = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.+)$/;

/**
 * Parse GCC/g++ stderr output and map line numbers back to user code.
 *
 * @param stderr          Raw stderr from the compiler.
 * @param harnessCodeOffset  Line number (1-based) of the {{USER_CODE}} line in the
 *                           generated harness -- i.e. the value returned by
 *                           `getHarnessCodeOffset()`.
 * @returns An array of errors whose line numbers are relative to user code (0-based).
 */
export function parseGccErrors(
    stderr: string,
    harnessCodeOffset: number,
    isPlugin = false,
    isInteractive = false,
): ParsedError[] {
    const results: ParsedError[] = [];
    const lines = stderr.split('\n');

    for (const line of lines) {
        const m = line.match(GCC_DIAG_RE);
        if (!m) {
            continue;
        }

        const [, filePath, lineStr, colStr, severity, message] = m;

        // Accept errors from the appropriate generated file
        const isHarness = filePath.includes('preview_harness');
        const isPluginFile = filePath.includes('preview_plugin');
        const isInteractiveFile = filePath.includes('preview_interactive');

        let matches: boolean;
        if (isInteractive) {
            matches = isInteractiveFile;
        } else if (isPlugin) {
            matches = isPluginFile;
        } else {
            matches = isHarness;
        }

        if (!matches) {
            continue;
        }

        const gccLine = parseInt(lineStr, 10);
        const column = parseInt(colStr, 10);

        // Map harness line -> user code line (0-based)
        const mappedLine = gccLine - harnessCodeOffset;

        if (mappedLine < 0) {
            // Error is in the harness boilerplate above user code -- skip
            continue;
        }

        results.push({
            line: mappedLine,
            column,
            message,
            severity: severity as ParsedError['severity'],
        });
    }

    return results;
}

/**
 * Determine on which line (1-based) the `{{USER_CODE}}` placeholder appears
 * in the plugin template.
 */
export function getPluginCodeOffset(templateContent: string): number {
    return getHarnessCodeOffset(templateContent);
}

/**
 * Determine on which line (1-based) the `{{USER_CODE}}` placeholder appears
 * in the harness template.  This value is the offset that must be subtracted
 * from GCC line numbers to obtain user-code-relative line numbers.
 */
export function getHarnessCodeOffset(templateContent: string): number {
    const lines = templateContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('{{USER_CODE}}')) {
            // Return the 1-based line number of the placeholder line.
            // Lines before AND including the placeholder are "overhead".
            return i + 1;
        }
    }
    // Fallback -- should not happen with a valid template
    return 0;
}

/**
 * Summarise raw compiler stderr into a short, user-readable message.
 *
 * Used as a fallback when `parseGccErrors` returns an empty array — e.g. when
 * the error is in harness boilerplate (not user code), or when pkg-config /
 * linker steps fail rather than the compile itself.
 *
 * The function extracts the first meaningful error line and strips noisy
 * system-path prefixes, keeping the output under ~120 characters.
 */
export function formatRawError(raw: string): string {
    if (!raw || raw.trim().length === 0) {
        return 'Build failed (no output).';
    }

    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    // Prefer the first line that contains ': error:' — it is most informative.
    const errorLine = lines.find(l => /:\s*error:/i.test(l));
    const candidate = errorLine ?? lines[0];

    // Strip leading tmp-file path up to the first ':' that precedes a line number,
    // turning e.g. "/tmp/dali_preview/preview_harness.cpp:5:3: error: …"
    // into "Line 5:3: error: …"
    const mapped = candidate.replace(
        /^[^\s:]+:(\d+):(\d+):\s*(error|warning|note):\s*/i,
        'Line $1, Col $2: '
    );

    // Trim to a reasonable display length
    return mapped.length > 200 ? mapped.slice(0, 197) + '…' : mapped;
}

/**
 * Format parsed errors into a human-readable string.
 */
export function formatErrorsForDisplay(errors: ParsedError[]): string {
    if (errors.length === 0) {
        return 'No errors.';
    }

    return errors
        .map((e) => {
            const tag = e.severity === 'error' ? 'Error' : e.severity === 'warning' ? 'Warning' : 'Note';
            return `${tag} - Line ${e.line + 1}, Col ${e.column}: ${e.message}`;
        })
        .join('\n');
}
