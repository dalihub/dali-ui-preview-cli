#!/usr/bin/env node
/*
 * dali-ui-preview CLI entrypoint.
 *
 * Default command (M1): `dali-ui-preview <input> [--image <out.png>]` resolves
 * the preview code from <input> — a FILE path, a code block on STDIN (when
 * <input> is `-` or stdin is piped), or an inline `--code "<text>"` block —
 * templates the DALi harness, renders it inside the runtime container, ALWAYS
 * prints the canonical scene tree as JSON to stdout, and (only when `--image` is
 * given) copies the produced PNG to <out.png>. `--image` is OPTIONAL (Inv-6):
 * passing it writes the PNG but does NOT change stdout.
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): there is no vscode
 * outputChannel here, and stdout is RESERVED for the machine contract (the JSON
 * node tree, and `--version`/`--help` text). All diagnostics go to stderr via
 * console.error so a caller can pipe stdout straight into a JSON parser.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveInput, resolveFromCode, resolveFromStdin, ResolvedInput } from './inputResolver';
import { templateHarness } from './harnessTemplater';
import { renderInContainer, cleanupWorkDir } from './dockerRunner';
import { buildTree } from './treeModel';

const USAGE =
  'Usage: dali-ui-preview <input.cpp | -> [--image <out.png>]\n' +
  '       dali-ui-preview --code "<dali ui code>" [--image <out.png>]\n' +
  '       cat input.cpp | dali-ui-preview [--image <out.png>]\n' +
  '   (or --version | --help)\n' +
  '\n' +
  'Reads preview code from a file, from STDIN (a `-` positional or a piped\n' +
  'code block), or from an inline --code block, and prints the scene-tree JSON\n' +
  'to stdout. --image is optional; passing it also writes the rendered PNG.';

/**
 * Read the package version at runtime.
 *
 * We read + parse package.json rather than `import pkg from '../package.json'`
 * because package.json lives outside tsconfig's `rootDir` ("src"); importing it
 * as a module would pull it under the compilation root and break the build.
 * The compiled entry is `out/cli.js`, so package.json sits one directory up.
 */
function readVersion(): string {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: unknown };
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error('version field missing from package.json');
  }
  return pkg.version;
}

/** Parsed form of the default render command's positional + flag arguments. */
interface RenderArgs {
  /**
   * Positional input. A file path (preview file or marker-bearing source), or
   * `-` meaning "read a code block from stdin". `undefined` when no positional
   * was given (the caller then falls back to `--code` or piped stdin).
   */
  input?: string;
  /** Inline preview code from `--code <text>` (mutually exclusive with `input`). */
  code?: string;
  /** Destination PNG path from `--image <path>` (now OPTIONAL — Inv-6). */
  imageOut?: string;
}

/**
 * Parse the default-command arguments: an optional positional `<input>` (a file
 * path or `-` for stdin), an optional inline `--code <text>` (mutually exclusive
 * with the positional input), and an optional `--image <path>`. Unknown flags,
 * duplicate/missing flag values, or supplying BOTH a positional input and
 * `--code` throw so the caller can surface a clear diagnostic on stderr.
 *
 * Note: `--image` is intentionally NOT required here. Whether an input source
 * was supplied at all is decided in {@link runRender} (which also considers
 * piped stdin), so a bare `dali-ui-preview` with a pipe is valid.
 */
function parseRenderArgs(argv: string[]): RenderArgs {
  let input: string | undefined;
  let code: string | undefined;
  let imageOut: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--image') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--image requires a path argument.');
      }
      if (imageOut !== undefined) {
        throw new Error('--image was specified more than once.');
      }
      imageOut = value;
      i++; // consume the value
    } else if (arg === '--code') {
      const value = argv[i + 1];
      // `--code` value may legitimately start with '-' (it's arbitrary C++), so
      // only reject a genuinely missing value, not a leading-dash one.
      if (value === undefined) {
        throw new Error('--code requires a code-block argument.');
      }
      if (code !== undefined) {
        throw new Error('--code was specified more than once.');
      }
      code = value;
      i++; // consume the value
    } else if (arg === '-') {
      // A lone '-' is the stdin positional, not an option.
      if (input !== undefined) {
        throw new Error(`unexpected extra argument: ${arg}`);
      }
      input = arg;
    } else if (arg.startsWith('-')) {
      throw new Error(`unrecognized option: ${arg}`);
    } else if (input === undefined) {
      input = arg;
    } else {
      throw new Error(`unexpected extra argument: ${arg}`);
    }
  }

  if (input !== undefined && code !== undefined) {
    throw new Error('cannot combine a positional <input> with --code; pass exactly one.');
  }
  return { input, code, imageOut };
}

/**
 * Resolve the render input from the parsed args + stdin TTY state, choosing the
 * source per WU-3's precedence:
 *   - `--code <text>`            → inline code block (resolveFromCode);
 *   - positional `-`             → stdin code block (resolveFromStdin);
 *   - positional file path       → file (resolveInput);
 *   - no positional, no --code,
 *     stdin is piped (!isTTY)    → stdin code block (resolveFromStdin).
 * Throws a clear Error (surfaced on stderr + usage by the caller) when no input
 * source is given at all.
 */
async function resolveRenderInput(parsed: RenderArgs): Promise<ResolvedInput> {
  if (parsed.code !== undefined) {
    return resolveFromCode(parsed.code);
  }
  if (parsed.input === '-') {
    return resolveFromStdin();
  }
  if (parsed.input !== undefined) {
    return resolveInput(parsed.input);
  }
  if (!process.stdin.isTTY) {
    return resolveFromStdin();
  }
  throw new Error(
    'no input given: pass a <input.cpp> file, `-` (or pipe code on stdin), or --code "<text>".',
  );
}

/**
 * Render command: resolve input (file | stdin | inline) → template → render in
 * container → ALWAYS print the canonical scene tree as JSON to stdout → write
 * the PNG only when `--image` was supplied.
 *
 * STDOUT carries ONLY the JSON tree (the machine contract, Inv-6); every
 * diagnostic goes to stderr. `--image` does NOT change stdout. Returns the
 * process exit code.
 */
async function runRender(argv: string[]): Promise<number> {
  let parsed: RenderArgs;
  let resolved: ResolvedInput;
  try {
    parsed = parseRenderArgs(argv);
    // Resolve the input source up front: an "no input given" error here must
    // surface the usage banner, exactly like an arg-parse error.
    resolved = await resolveRenderInput(parsed);
  } catch (err) {
    console.error(`dali-ui-preview: ${err instanceof Error ? err.message : String(err)}`);
    console.error(USAGE);
    return 1;
  }

  if (resolved.code.trim().length === 0) {
    console.error('dali-ui-preview: input is empty — no preview code to render.');
    return 1;
  }

  let workDir: string | undefined;
  try {
    const source = templateHarness(resolved.code);
    const result = await renderInContainer(source);
    workDir = result.workDir;

    // Emit the canonical scene tree as JSON to stdout (the machine contract).
    // This is UNCONDITIONAL — stdout is identical whether or not --image is set.
    const tree = buildTree(result.metadataJson, {
      sourceCode: resolved.code,
      startLine: resolved.startLine,
    });
    process.stdout.write(`${JSON.stringify(tree)}\n`);

    // PNG is written ONLY when --image was supplied; otherwise the harness's PNG
    // stays in the temp workDir and is removed by the finally cleanup below.
    if (parsed.imageOut !== undefined) {
      const destDir = path.dirname(path.resolve(parsed.imageOut));
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.copyFile(result.pngPath, parsed.imageOut);
    }

    return 0;
  } catch (err) {
    console.error(`dali-ui-preview: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    if (workDir !== undefined) {
      cleanupWorkDir(workDir);
    }
  }
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // A bare invocation (no args) is only a usage request when stdin is an
  // interactive TTY. If code is piped in (`cat x.cpp | dali-ui-preview`), fall
  // through to runRender, which reads the piped stdin code block.
  if (argv.length === 0 && process.stdin.isTTY) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // Default command: resolve input (file | stdin | --code), print the tree,
  // and write the PNG only when --image was supplied.
  return runRender(argv);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`dali-ui-preview: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
