/*
 * harnessTemplater.ts — fill the vendored DALi preview harness template with
 * concrete values, producing a complete C++ source string ready to write to
 * `workDir/source.cpp`, for the dali-ui-preview CLI (M0/WU-3).
 *
 * The template (`server/preview_harness.cpp.template`, vendored in WU-2) contains
 * `{{...}}` placeholders that this module substitutes. Every placeholder must be
 * filled — the returned string MUST contain no remaining `{{...}}` token, or the
 * generated C++ would fail to compile. Some placeholders appear more than once
 * (e.g. `{{BACKGROUND_COLOR}}`, `{{OUTPUT_PATH}}`), so substitution is global.
 *
 * M0 uses fixed defaults: theme / dpr / resolution flags arrive in M5. Width and
 * height are emitted as float literals (`1024.0f`) because the harness declares
 * `static const float PREVIEW_WIDTH = {{PREVIEW_WIDTH}};`.
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): stdout is reserved
 * for the machine contract (the JSON node tree); this module never writes to
 * stdout. Failures (e.g. an unreadable template, or a leftover placeholder) are
 * surfaced by throwing.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Tunable substitutions for {@link templateHarness}; all optional in M0. */
export interface TemplateOptions {
    /** Preview width in px (default 1024). Emitted as a `<n>.0f` float literal. */
    width?: number;
    /** Preview height in px (default 600). Emitted as a `<n>.0f` float literal. */
    height?: number;
    /**
     * A valid DALi color expression used both for `window.SetBackgroundColor(...)`
     * and as the `Capture.Start(..., <color>)` argument (default
     * `Dali::Color::BLACK`).
     */
    backgroundColor?: string;
    /**
     * C++ statements injected at the top of `OnInit` to register custom fonts.
     * Must be valid inside the `OnInit` body. Default: a `// no custom fonts`
     * comment (no-op).
     */
    fontSetup?: string;
    /** Absolute container path the harness writes the captured PNG to. */
    outputPath?: string;
    /** Absolute container path the harness writes the scene-tree JSON to. */
    metadataPath?: string;
    /**
     * Override the template file location (for tests). Defaults to
     * `<package root>/server/preview_harness.cpp.template`.
     */
    templatePath?: string;
}

/** M0 fixed defaults (no theme / dpr / resolution flags yet — those are M5). */
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 600;
const DEFAULT_BACKGROUND_COLOR = 'Dali::Color::BLACK';
// A comment keeps the OnInit body valid while injecting nothing.
const DEFAULT_FONT_SETUP = '    // no custom fonts';
const DEFAULT_OUTPUT_PATH = '/work/preview.png';
const DEFAULT_METADATA_PATH = '/work/tree.json';

/**
 * Resolve the default on-disk location of the harness template.
 *
 * The compiled module lives at `out/harnessTemplater.js`, so the package root —
 * which holds `server/preview_harness.cpp.template` — is one directory up.
 */
function defaultTemplatePath(): string {
    return path.join(__dirname, '..', 'server', 'preview_harness.cpp.template');
}

/**
 * Replace every occurrence of a `{{NAME}}` placeholder with `value`.
 *
 * `value` is inserted literally (no `$`-pattern interpretation), so user code or
 * paths containing `$1`/`$&` are embedded verbatim.
 */
function fillPlaceholder(source: string, name: string, value: string): string {
    return source.split(`{{${name}}}`).join(value);
}

/**
 * Render the harness template with `userCode` and the supplied options into a
 * complete, placeholder-free C++ source string.
 *
 * @param userCode  The resolved preview C++ (verbatim). It is inserted into the
 *                  `View CreatePreviewUI() { ... }` body, so for a typical sample
 *                  it is the file's `return TypeName::New()...;`.
 * @param opts      Optional overrides; see {@link TemplateOptions}. Defaults
 *                  match the M0 fixed configuration.
 * @returns         The fully substituted harness C++ source.
 * @throws          If the template cannot be read, or any `{{...}}` placeholder
 *                  remains after substitution.
 */
export function templateHarness(userCode: string, opts: TemplateOptions = {}): string {
    const width = opts.width ?? DEFAULT_WIDTH;
    const height = opts.height ?? DEFAULT_HEIGHT;
    const backgroundColor = opts.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
    const fontSetup = opts.fontSetup ?? DEFAULT_FONT_SETUP;
    const outputPath = opts.outputPath ?? DEFAULT_OUTPUT_PATH;
    const metadataPath = opts.metadataPath ?? DEFAULT_METADATA_PATH;
    const templatePath = opts.templatePath ?? defaultTemplatePath();

    let template: string;
    try {
        template = fs.readFileSync(templatePath, 'utf8');
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot read harness template '${templatePath}': ${reason}`);
    }

    // Emit width/height as float literals — the harness declares them as
    // `static const float`, matching the vendored extension's substitution.
    let out = template;
    out = fillPlaceholder(out, 'PREVIEW_WIDTH', `${width}.0f`);
    out = fillPlaceholder(out, 'PREVIEW_HEIGHT', `${height}.0f`);
    out = fillPlaceholder(out, 'USER_CODE', userCode);
    out = fillPlaceholder(out, 'FONT_SETUP', fontSetup);
    out = fillPlaceholder(out, 'BACKGROUND_COLOR', backgroundColor);
    out = fillPlaceholder(out, 'OUTPUT_PATH', outputPath);
    out = fillPlaceholder(out, 'METADATA_PATH', metadataPath);

    // Safety net: a leftover placeholder would produce uncompilable C++.
    const leftover = out.match(/\{\{[A-Z_]+\}\}/);
    if (leftover) {
        throw new Error(
            `Harness template still contains an unfilled placeholder '${leftover[0]}' ` +
            `after substitution (template: '${templatePath}').`,
        );
    }

    return out;
}
