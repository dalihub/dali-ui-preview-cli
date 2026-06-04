#!/usr/bin/env node
/*
 * dali-ui-preview CLI entrypoint.
 *
 * Default command (M0): `dali-ui-preview <input> --image <out.png>` resolves the
 * preview code from <input>, templates the DALi harness, renders it inside the
 * runtime container, copies the produced PNG to <out.png> (WU-4), and prints the
 * minimal scene tree as JSON to stdout (WU-5).
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): there is no vscode
 * outputChannel here, and stdout is RESERVED for the machine contract (the JSON
 * node tree, and `--version`/`--help` text). All diagnostics go to stderr via
 * console.error so a caller can pipe stdout straight into a JSON parser.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveInput } from './inputResolver';
import { templateHarness } from './harnessTemplater';
import { renderInContainer, cleanupWorkDir } from './dockerRunner';
import { buildTree } from './treeModel';

const USAGE = 'Usage: dali-ui-preview <input.cpp> --image <out.png>   (or --version | --help)';

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
  /** Positional input file path (preview file or marker-bearing source). */
  input: string;
  /** Destination PNG path from `--image <path>`. */
  imageOut: string;
}

/**
 * Parse the default-command arguments: a single positional `<input>` and a
 * required `--image <path>`. Unknown flags or missing/duplicate values throw so
 * the caller can surface a clear diagnostic on stderr.
 */
function parseRenderArgs(argv: string[]): RenderArgs {
  let input: string | undefined;
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
    } else if (arg.startsWith('-')) {
      throw new Error(`unrecognized option: ${arg}`);
    } else if (input === undefined) {
      input = arg;
    } else {
      throw new Error(`unexpected extra argument: ${arg}`);
    }
  }

  if (input === undefined) {
    throw new Error('missing required <input> argument.');
  }
  if (imageOut === undefined) {
    throw new Error('missing required --image <path> argument.');
  }
  return { input, imageOut };
}

/**
 * Render command: resolve → template → render in container → copy PNG out →
 * print the minimal scene tree as JSON to stdout.
 *
 * STDOUT carries ONLY the JSON tree (the machine contract, Inv-6); every
 * diagnostic goes to stderr. Returns the process exit code.
 */
async function runRender(argv: string[]): Promise<number> {
  let parsed: RenderArgs;
  try {
    parsed = parseRenderArgs(argv);
  } catch (err) {
    console.error(`dali-ui-preview: ${err instanceof Error ? err.message : String(err)}`);
    console.error(USAGE);
    return 1;
  }

  let workDir: string | undefined;
  try {
    const resolved = resolveInput(parsed.input);
    const source = templateHarness(resolved.code);
    const result = await renderInContainer(source);
    workDir = result.workDir;

    // Copy the produced PNG to the user's --image destination, creating any
    // missing parent directories.
    const destDir = path.dirname(path.resolve(parsed.imageOut));
    await fs.promises.mkdir(destDir, { recursive: true });
    await fs.promises.copyFile(result.pngPath, parsed.imageOut);

    // Emit the minimal scene tree as JSON to stdout (the machine contract).
    const tree = buildTree(result.metadataJson);
    process.stdout.write(`${JSON.stringify(tree)}\n`);

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

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // Default command: render <input>, write the PNG to --image, print the tree.
  return runRender(argv);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`dali-ui-preview: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
