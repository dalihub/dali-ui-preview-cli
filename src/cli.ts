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
import { nodeAt, nodeById, toRegion } from './treeQuery';
import { renderOverlay } from './overlayRenderer';

const USAGE =
  'Usage: dali-ui-preview <input.cpp | -> [--image <out.png>]\n' +
  '       dali-ui-preview --code "<dali ui code>" [--image <out.png>]\n' +
  '       cat input.cpp | dali-ui-preview [--image <out.png>]\n' +
  '       dali-ui-preview <input.cpp> --overlay <out.png>   (write a Set-of-Mark annotated PNG)\n' +
  '       dali-ui-preview <input.cpp> --at X,Y              (print the topmost node at a pixel)\n' +
  '       dali-ui-preview <input.cpp> --node <id>           (print that node id\'s region)\n' +
  '   (or --version | --help)\n' +
  '\n' +
  'Reads preview code from a file, from STDIN (a `-` positional or a piped\n' +
  'code block), or from an inline --code block, and prints the scene-tree JSON\n' +
  'to stdout. --image is optional; passing it also writes the rendered PNG.\n' +
  '--at/--node print ONLY their lookup JSON (a bare render prints the full tree);\n' +
  'they are mutually exclusive. --overlay writes an annotated PNG and is\n' +
  'orthogonal to stdout (the full tree is still printed unless a query flag is set).';

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
  /** Destination PNG path from `--overlay <path>` — writes a Set-of-Mark PNG (F2.1). */
  overlayOut?: string;
  /** Pixel from `--at X,Y` — print the topmost node at that coordinate (F2.3). */
  at?: { x: number; y: number };
  /** Structural id from `--node <id>` — print that node's region (F2.4). */
  nodeId?: string;
}

/**
 * Parse the default-command arguments: an optional positional `<input>` (a file
 * path or `-` for stdin), an optional inline `--code <text>` (mutually exclusive
 * with the positional input), an optional `--image <path>`, and the M2 image↔tree
 * flags `--overlay <png>` (write a Set-of-Mark annotated PNG), `--at X,Y` (query
 * the node at a pixel) and `--node <id>` (query a node's region). Unknown flags,
 * duplicate/missing flag values, a malformed `--at` value, supplying BOTH a
 * positional input and `--code`, or supplying BOTH `--at` and `--node` throw so the
 * caller can surface a clear diagnostic on stderr.
 *
 * Note: `--image`/`--overlay` are intentionally NOT required here. Whether an input
 * source was supplied at all is decided in {@link runRender} (which also considers
 * piped stdin), so a bare `dali-ui-preview` with a pipe is valid.
 */
function parseRenderArgs(argv: string[]): RenderArgs {
  let input: string | undefined;
  let code: string | undefined;
  let imageOut: string | undefined;
  let overlayOut: string | undefined;
  let at: { x: number; y: number } | undefined;
  let nodeId: string | undefined;

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
    } else if (arg === '--overlay') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--overlay requires a path argument.');
      }
      if (overlayOut !== undefined) {
        throw new Error('--overlay was specified more than once.');
      }
      overlayOut = value;
      i++; // consume the value
    } else if (arg === '--at') {
      const value = argv[i + 1];
      if (value === undefined || !/^-?\d+,-?\d+$/.test(value)) {
        throw new Error('--at requires X,Y integer pixel coordinates.');
      }
      if (at !== undefined) {
        throw new Error('--at was specified more than once.');
      }
      const [xStr, yStr] = value.split(',');
      at = { x: parseInt(xStr, 10), y: parseInt(yStr, 10) };
      i++; // consume the value
    } else if (arg === '--node') {
      const value = argv[i + 1];
      // The id is a structural child-index path (e.g. "0/1/0") so it never starts
      // with '-'; reject a genuinely missing value or a leading-dash one.
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--node requires an id argument.');
      }
      if (nodeId !== undefined) {
        throw new Error('--node was specified more than once.');
      }
      nodeId = value;
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
  // One query per invocation keeps stdout a single JSON value (Inv-6).
  if (at !== undefined && nodeId !== undefined) {
    throw new Error('pass at most one query flag: --at or --node, not both.');
  }
  return { input, code, imageOut, overlayOut, at, nodeId };
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
 * container → build the annotated tree → select stdout per the query flags →
 * write the PNG(s) for `--image` / `--overlay` when supplied.
 *
 * STDOUT carries a SINGLE JSON value (the machine contract, Inv-6): the full scene
 * tree for a bare render, or just the lookup result when `--at` / `--node` is set.
 * `--image` / `--overlay` are file side-effects orthogonal to stdout. Every
 * diagnostic goes to stderr. Returns the process exit code.
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

    // Build the annotated canonical tree (now carrying the M2 `mark`). This is the
    // single source every surface below reads — overlay marks, --at/--node, stdout.
    const tree = buildTree(result.metadataJson, {
      sourceCode: resolved.code,
      startLine: resolved.startLine,
    });

    // --overlay writes a Set-of-Mark annotated PNG; it implies render (already
    // done) and is orthogonal to stdout (Inv-6). Written before stdout selection.
    if (parsed.overlayOut !== undefined) {
      const overlayDir = path.dirname(path.resolve(parsed.overlayOut));
      await fs.promises.mkdir(overlayDir, { recursive: true });
      await renderOverlay(result.pngPath, tree, parsed.overlayOut);
    }

    // STDOUT selection (the contract): a query flag prints ONLY its lookup JSON;
    // a bare render prints the full tree (M1 behaviour, unchanged).
    if (parsed.at !== undefined) {
      const hit = nodeAt(tree, parsed.at.x, parsed.at.y);
      const payload = hit !== null ? toRegion(hit) : { at: [parsed.at.x, parsed.at.y], node: null };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else if (parsed.nodeId !== undefined) {
      const n = nodeById(tree, parsed.nodeId);
      process.stdout.write(`${JSON.stringify(n !== null ? toRegion(n) : null)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(tree)}\n`);
    }

    // PNG is copied out ONLY when --image was supplied; otherwise the harness's PNG
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
