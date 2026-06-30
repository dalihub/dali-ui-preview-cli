#!/usr/bin/env node
/*
 * dali-ui-preview-cli CLI entrypoint.
 *
 * Default command (M1): `dali-ui-preview-cli <input> [--image <out.png>]` resolves
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
import { templateHarness, userCodeOffset, THEME_BACKGROUND } from './harnessTemplater';
import {
  renderInContainer,
  cleanupWorkDir,
  RenderError,
  isDockerAvailable,
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_IMAGE_TAG,
} from './dockerRunner';
import { listVersions, pullImage } from './imageManager';
import { buildSlice } from './sliceBuilder';
import { resolveProjectIncludes } from './sliceSources';
import { buildTree, MinimalNode } from './treeModel';
import { parseGccErrors, formatRawError } from './errorParser';
import { nodeAt, nodeById, toRegion } from './treeQuery';
import { renderOverlay } from './overlayRenderer';
import { formatTree } from './formatters/treeFormatter';
import { writeReport } from './formatters/reportFormatter';
import { truncate } from './treeTruncate';
import { runWatch } from './watch';
import { imageDiff, ImageDiffResult } from './diff/imageDiff';
import { treeDiff, TreeDiffResult } from './diff/treeDiff';
import { buildVerdict, verdictExitCode } from './diff/verdict';

/**
 * Process exit codes (M5/F5.4). Distinct per failure phase so a caller can branch
 * on `$?` without parsing stderr. 0/1/20 are the pre-M5 contract (kept); 10/11/12
 * split the former blanket "1" for a render failure into compile / render /
 * docker-unavailable.
 */
const EXIT = {
  /** Success. */
  OK: 0,
  /** Usage / arg error, or empty input. */
  USAGE: 1,
  /** Compile error in the user's code (RenderError, phase 'compile'). */
  COMPILE_ERROR: 10,
  /** Render / capture error (RenderError, phase 'render'). */
  RENDER_ERROR: 11,
  /** Docker unavailable (the `docker info` preflight failed). */
  DOCKER_UNAVAILABLE: 12,
  /** Diff mismatch — the verify verdict diverged (M4; set by verdictExitCode). */
  DIFF_MISMATCH: 20,
} as const;

/** The two `--theme` values; each maps to a DALi background color (F5.1). */
type Theme = 'dark' | 'light';

/** Default LOGICAL render resolution (device pixels = these × dpr). TV FHD —
 *  DALi UI apps target the TV; override per render with `--resolution WxH`. */
const DEFAULT_RESOLUTION = { w: 1920, h: 1080 } as const;
/** Default theme (the pre-M5 black background). */
const DEFAULT_THEME: Theme = 'dark';
/** Default device-pixel ratio. */
const DEFAULT_DPR = 1;

/**
 * The structured compile/render error printed (as JSON) to STDERR on a
 * {@link RenderError} (F5.3). `sourceLine` is the user's 1-based absolute source
 * line the first diagnostic maps to, or null when none could be mapped (e.g. the
 * error is in harness boilerplate, or it is a render-phase failure with no g++
 * line).
 */
export interface StructuredError {
  phase: RenderError['phase'];
  message: string;
  sourceLine: number | null;
}

const USAGE =
  'Usage: dali-ui-preview-cli <input.cpp | -> [--image <out.png>]\n' +
  '       dali-ui-preview-cli --code "<dali ui code>" [--image <out.png>]\n' +
  '       cat input.cpp | dali-ui-preview-cli [--image <out.png>]\n' +
  '       dali-ui-preview-cli <input.cpp> --format tree         (print a box-drawing tree instead of JSON)\n' +
  '       dali-ui-preview-cli <input.cpp> --report <out.html|.md> (write a self-contained report)\n' +
  '       dali-ui-preview-cli <input.cpp> --max-depth N | --max-nodes N (bound the stdout JSON)\n' +
  '       dali-ui-preview-cli <input.cpp> --overlay <out.png>   (write a Set-of-Mark annotated PNG)\n' +
  '       dali-ui-preview-cli <input.cpp> --at X,Y              (print the topmost node at a pixel)\n' +
  '       dali-ui-preview-cli <input.cpp> --node <id>           (print that node id\'s region)\n' +
  '       dali-ui-preview-cli <input.cpp> --watch               (re-render on file change; FILE input only)\n' +
  '       dali-ui-preview-cli <input.cpp> --baseline <png> [--baseline-tree <json>] [--threshold <ratio>]\n' +
  '                                                              (verify the render; print a verdict, exit 0 match / 20 diverged)\n' +
  '       dali-ui-preview-cli <input.cpp> --update-baseline --baseline <png> [--baseline-tree <json>]\n' +
  '                                                              (write the current render as the new baseline; exit 0)\n' +
  '       dali-ui-preview-cli <input.cpp> --resolution WxH       (render size, default 1920x1080)\n' +
  '       dali-ui-preview-cli <input.cpp> --theme dark|light     (background theme, default dark)\n' +
  '       dali-ui-preview-cli <input.cpp> --dpr N                (device-pixel ratio, default 1)\n' +
  '       dali-ui-preview-cli <input.cpp> --image-tag <tag>      (runtime image tag for THIS render, default latest)\n' +
  '       dali-ui-preview-cli <input.cpp> --image <name>         (override the runtime image name; advanced)\n' +
  '       dali-ui-preview-cli --list-versions                    (list runtime image versions as JSON; exit 0)\n' +
  '       dali-ui-preview-cli --pull [<tag>]                     (pull a runtime image tag, default latest)\n' +
  '       dali-ui-preview-cli init [<dir>]                       (set up a project so a coding agent verifies DALi UI in its loop)\n' +
  '   (or --version | --help)\n' +
  '\n' +
  'Reads preview code from a file, from STDIN (a `-` positional or a piped\n' +
  'code block), or from an inline --code block, and prints the scene-tree JSON\n' +
  'to stdout. --image is optional; passing it also writes the rendered PNG.\n' +
  '--format tree prints a human box-drawing tree instead of JSON; --max-depth /\n' +
  '--max-nodes bound the JSON for token-limited callers. --report writes an HTML\n' +
  '(.html) or Markdown (.md) report and still prints the JSON tree to stdout.\n' +
  '--at/--node print ONLY their lookup JSON (a bare render prints the full tree);\n' +
  'they are mutually exclusive. --overlay writes an annotated PNG and is\n' +
  'orthogonal to stdout (the full tree is still printed unless a query flag is set).\n' +
  '--watch requires a FILE input (not stdin / --code).\n' +
  '--baseline / --baseline-tree VERIFY the render: stdout becomes a single verdict\n' +
  'JSON (image-diff and/or id-keyed tree-diff vs the baseline) and the exit code is\n' +
  '0 when it matches or 20 when it diverges (1 stays a tool error). --update-baseline\n' +
  '(needs --baseline) instead writes the current render as the new baseline(s).\n' +
  '--resolution WxH sets the logical render size (default 1920x1080); --theme dark|light\n' +
  'picks the background color (default dark); --dpr N (default 1) multiplies the render\n' +
  'dimensions by N device pixels. The effective {resolution,theme,dpr} are echoed on the\n' +
  'stdout tree as root.meta.\n' +
  '\n' +
  'Runtime versions track DALi releases (e.g. dali_2.5.18), plus the rolling `latest`.\n' +
  '--list-versions prints the available runtime image versions (remote ∪ local, each\n' +
  'marked local/current) as JSON; --pull [<tag>] downloads a tag (default latest);\n' +
  '--image-tag <tag> selects the tag for THIS render (default latest); --image <name>\n' +
  'overrides the runtime image name. --list-versions / --pull do NOT render.\n' +
  '\n' +
  'Exit codes: 0 ok; 1 usage error or empty input; 10 compile error (in your code);\n' +
  '11 render/capture error; 12 docker unavailable; 20 verify diff mismatch.\n' +
  'A compile/render failure prints a JSON {phase,message,sourceLine} to stderr.';

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
export interface RenderArgs {
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
  /** Stdout shape from `--format <tree|json>` (default 'json') (M3/F3.1). */
  format?: 'tree' | 'json';
  /** Report destination from `--report <file>`; .html or .md by extension (F3.2). */
  reportOut?: string;
  /** Max tree depth for the stdout JSON from `--max-depth N` (F3.3). */
  maxDepth?: number;
  /** Max node count for the stdout JSON from `--max-nodes N` (F3.3). */
  maxNodes?: number;
  /** `--watch`: re-render on file change; requires a FILE input (F3.4). */
  watch?: boolean;
  /** Baseline PNG from `--baseline <png>` — image-diff the render against it (F4.1). */
  baseline?: string;
  /** Baseline tree JSON from `--baseline-tree <json>` — tree-diff against it (F4.2). */
  baselineTree?: string;
  /** `--update-baseline`: write the current render as the new baseline(s) (F4.4). */
  updateBaseline?: boolean;
  /** Image-diff fail ratio from `--threshold <ratio>` (default 0.01) (F4.1/F4.3). */
  threshold?: number;
  /** Logical render size from `--resolution WxH` (default 1920x1080) (F5.1). */
  resolution?: { w: number; h: number };
  /** Background theme from `--theme dark|light` (default dark) (F5.1). */
  theme?: Theme;
  /** Device-pixel ratio from `--dpr N` (default 1); scales render dims (F5.1). */
  dpr?: number;
  /** Runtime image tag from `--image-tag <tag>` (default 'latest'); selects the runtime version. */
  imageTag?: string;
  /** Runtime image name from `--image <name>` (default DEFAULT_DOCKER_IMAGE); advanced override. */
  image?: string;
  /** `--list-versions`: list runtime image versions (remote ∪ local) as JSON; does NOT render. */
  listVersions?: boolean;
  /** `--pull [<tag>]`: pull a runtime image tag; does NOT render. `''` means the default tag. */
  pull?: { tag?: string };
}

/**
 * Parse + validate a non-negative integer flag value (`--max-depth`/`--max-nodes`).
 * Throws a clear Error when the value is missing or not a base-10 non-negative
 * integer, so the caller surfaces a usage diagnostic on stderr.
 */
function parseCountFlag(flag: string, value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${flag} requires a non-negative integer argument.`);
  }
  return parseInt(value, 10);
}

/**
 * Parse + validate a `--threshold` ratio: a finite number in [0,1]. Throws a clear
 * Error when missing or out of range so the caller surfaces a usage diagnostic on
 * stderr. Accepts forms like `0`, `0.01`, `.5`, `1`.
 */
function parseRatioFlag(flag: string, value: string | undefined): number {
  if (value === undefined || !/^\d*\.?\d+$/.test(value)) {
    throw new Error(`${flag} requires a number between 0 and 1.`);
  }
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${flag} requires a number between 0 and 1.`);
  }
  return n;
}

/**
 * Parse + validate a `--resolution WxH` value into positive integer logical
 * dimensions (e.g. `800x480` → `{w:800,h:480}`). Accepts a lowercase or uppercase
 * `x` separator. Throws a clear usage Error when malformed or non-positive.
 */
function parseResolutionFlag(value: string | undefined): { w: number; h: number } {
  const m = value !== undefined ? /^(\d+)[xX](\d+)$/.exec(value) : null;
  if (m === null) {
    throw new Error('--resolution requires a WxH value (e.g. 800x480).');
  }
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (w <= 0 || h <= 0) {
    throw new Error('--resolution width and height must be positive (e.g. 800x480).');
  }
  return { w, h };
}

/**
 * Parse + validate a `--dpr N` value: a finite, positive number (integer or
 * decimal, e.g. `1`, `2`, `1.5`). Throws a clear usage Error otherwise.
 */
function parseDprFlag(value: string | undefined): number {
  if (value === undefined || !/^\d*\.?\d+$/.test(value)) {
    throw new Error('--dpr requires a positive number (e.g. 1, 2, 1.5).');
  }
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('--dpr requires a positive number (e.g. 1, 2, 1.5).');
  }
  return n;
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
 * piped stdin), so a bare `dali-ui-preview-cli` with a pipe is valid.
 */
function parseRenderArgs(argv: string[]): RenderArgs {
  let input: string | undefined;
  let code: string | undefined;
  let imageOut: string | undefined;
  let overlayOut: string | undefined;
  let at: { x: number; y: number } | undefined;
  let nodeId: string | undefined;
  let format: 'tree' | 'json' | undefined;
  let reportOut: string | undefined;
  let maxDepth: number | undefined;
  let maxNodes: number | undefined;
  let watch = false;
  let baseline: string | undefined;
  let baselineTree: string | undefined;
  let updateBaseline = false;
  let threshold: number | undefined;
  let resolution: { w: number; h: number } | undefined;
  let theme: Theme | undefined;
  let dpr: number | undefined;
  let imageTag: string | undefined;
  let image: string | undefined;
  let listVersions = false;
  let pull: { tag?: string } | undefined;

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
    } else if (arg === '--format') {
      const value = argv[i + 1];
      if (value !== 'tree' && value !== 'json') {
        throw new Error("--format requires a value of 'tree' or 'json'.");
      }
      if (format !== undefined) {
        throw new Error('--format was specified more than once.');
      }
      format = value;
      i++; // consume the value
    } else if (arg === '--report') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--report requires a path argument.');
      }
      if (reportOut !== undefined) {
        throw new Error('--report was specified more than once.');
      }
      reportOut = value;
      i++; // consume the value
    } else if (arg === '--max-depth') {
      if (maxDepth !== undefined) {
        throw new Error('--max-depth was specified more than once.');
      }
      maxDepth = parseCountFlag('--max-depth', argv[i + 1]);
      i++; // consume the value
    } else if (arg === '--max-nodes') {
      if (maxNodes !== undefined) {
        throw new Error('--max-nodes was specified more than once.');
      }
      maxNodes = parseCountFlag('--max-nodes', argv[i + 1]);
      i++; // consume the value
    } else if (arg === '--watch') {
      watch = true;
    } else if (arg === '--baseline') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--baseline requires a path argument.');
      }
      if (baseline !== undefined) {
        throw new Error('--baseline was specified more than once.');
      }
      baseline = value;
      i++; // consume the value
    } else if (arg === '--baseline-tree') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--baseline-tree requires a path argument.');
      }
      if (baselineTree !== undefined) {
        throw new Error('--baseline-tree was specified more than once.');
      }
      baselineTree = value;
      i++; // consume the value
    } else if (arg === '--update-baseline') {
      updateBaseline = true;
    } else if (arg === '--threshold') {
      if (threshold !== undefined) {
        throw new Error('--threshold was specified more than once.');
      }
      threshold = parseRatioFlag('--threshold', argv[i + 1]);
      i++; // consume the value
    } else if (arg === '--resolution') {
      if (resolution !== undefined) {
        throw new Error('--resolution was specified more than once.');
      }
      resolution = parseResolutionFlag(argv[i + 1]);
      i++; // consume the value
    } else if (arg === '--theme') {
      const value = argv[i + 1];
      if (value !== 'dark' && value !== 'light') {
        throw new Error("--theme requires a value of 'dark' or 'light'.");
      }
      if (theme !== undefined) {
        throw new Error('--theme was specified more than once.');
      }
      theme = value;
      i++; // consume the value
    } else if (arg === '--dpr') {
      if (dpr !== undefined) {
        throw new Error('--dpr was specified more than once.');
      }
      dpr = parseDprFlag(argv[i + 1]);
      i++; // consume the value
    } else if (arg === '--image-tag') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--image-tag requires a tag argument (e.g. latest, dali_2.5.18).');
      }
      if (imageTag !== undefined) {
        throw new Error('--image-tag was specified more than once.');
      }
      imageTag = value;
      i++; // consume the value
    } else if (arg === '--runtime-image') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--runtime-image requires an image-name argument.');
      }
      if (image !== undefined) {
        throw new Error('--runtime-image was specified more than once.');
      }
      image = value;
      i++; // consume the value
    } else if (arg === '--list-versions') {
      listVersions = true;
    } else if (arg === '--pull') {
      if (pull !== undefined) {
        throw new Error('--pull was specified more than once.');
      }
      // The tag is OPTIONAL: consume the next token only when it is a bare value
      // (not another flag and not absent). `--pull` alone defaults to 'latest'
      // (resolved at the dispatch site).
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('-')) {
        pull = { tag: value };
        i++; // consume the optional tag
      } else {
        pull = {};
      }
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
  // --watch re-renders the input file on change, so it needs a watchable FILE.
  // The unwatchable sources are known here: an inline --code block or a `-`/piped
  // stdin block. (The remaining "no positional + piped stdin" case is rejected in
  // runRender, where stdin's TTY state is known.)
  if (watch && (code !== undefined || input === '-')) {
    throw new Error('--watch requires a FILE input (not stdin or --code).');
  }
  // --update-baseline writes the current render as the baseline, so it needs a
  // destination PNG (and optionally a tree-JSON destination).
  if (updateBaseline && baseline === undefined) {
    throw new Error('--update-baseline requires --baseline <png> (the destination).');
  }
  // Verify mode replaces the normal tree stdout with a single verdict JSON, so it
  // cannot share stdout with a query/format flag, and it is a one-shot (no --watch).
  const verifying = baseline !== undefined || baselineTree !== undefined;
  if (verifying) {
    if (at !== undefined || nodeId !== undefined) {
      throw new Error('--baseline/--baseline-tree cannot be combined with --at/--node.');
    }
    if (format !== undefined || reportOut !== undefined) {
      throw new Error('--baseline/--baseline-tree cannot be combined with --format/--report.');
    }
    if (watch) {
      throw new Error('--baseline/--baseline-tree cannot be combined with --watch.');
    }
  }
  // --threshold only affects the image diff; it is meaningless without a baseline.
  if (threshold !== undefined && baseline === undefined) {
    throw new Error('--threshold requires --baseline <png>.');
  }
  // Management commands (--list-versions / --pull) operate on the runtime image,
  // not on a render: they are mutually exclusive with each other and with every
  // render/verify-only flag. (--runtime-image / --image-tag DO apply to them, so
  // those are deliberately not rejected here.)
  if (listVersions && pull !== undefined) {
    throw new Error('pass at most one management command: --list-versions or --pull, not both.');
  }
  const managing = listVersions || pull !== undefined;
  if (managing) {
    if (input !== undefined || code !== undefined) {
      throw new Error('--list-versions / --pull do not take an input; remove it.');
    }
    if (
      imageOut !== undefined || overlayOut !== undefined || at !== undefined || nodeId !== undefined ||
      format !== undefined || reportOut !== undefined || maxDepth !== undefined || maxNodes !== undefined ||
      watch || baseline !== undefined || baselineTree !== undefined || updateBaseline ||
      threshold !== undefined || resolution !== undefined || theme !== undefined || dpr !== undefined
    ) {
      throw new Error('--list-versions / --pull cannot be combined with render or verify flags.');
    }
  }
  return {
    input, code, imageOut, overlayOut, at, nodeId, format, reportOut, maxDepth, maxNodes, watch,
    baseline, baselineTree, updateBaseline, threshold, resolution, theme, dpr,
    imageTag, image, listVersions, pull,
  };
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

/** The effective render config derived from the M5 flags (with defaults applied). */
export interface RenderConfig {
  /** Logical resolution (the EFFECTIVE values echoed in `root.meta`). */
  resolution: { w: number; h: number };
  /** Effective theme. */
  theme: Theme;
  /** Effective device-pixel ratio. */
  dpr: number;
  /** Device-pixel render width = `resolution.w * dpr` (passed to the harness/container). */
  deviceWidth: number;
  /** Device-pixel render height = `resolution.h * dpr` (passed to the harness/container). */
  deviceHeight: number;
  /** DALi background-color expression for the chosen theme. */
  backgroundColor: string;
}

/**
 * Resolve the M5 render config from parsed args: apply defaults (1920x1080 / dark /
 * 1), scale the logical resolution by `dpr` into DEVICE pixels (rounded to an
 * integer, since Xvfb/PREVIEW_WIDTH and the harness float literal are whole
 * pixels), and pick the theme's background color. The LOGICAL `resolution`/`dpr`
 * are what `root.meta` echoes (F5.2); the DEVICE dims are what the harness +
 * container actually render at (F5.1).
 */
export function resolveRenderConfig(parsed: RenderArgs): RenderConfig {
  const resolution = parsed.resolution ?? { w: DEFAULT_RESOLUTION.w, h: DEFAULT_RESOLUTION.h };
  const theme = parsed.theme ?? DEFAULT_THEME;
  const dpr = parsed.dpr ?? DEFAULT_DPR;
  return {
    resolution,
    theme,
    dpr,
    deviceWidth: Math.round(resolution.w * dpr),
    deviceHeight: Math.round(resolution.h * dpr),
    backgroundColor: THEME_BACKGROUND[theme],
  };
}

/** The resolved runtime image coordinates a render/verify/management command uses. */
interface ImageRef {
  /** Base image name without tag (default {@link DEFAULT_DOCKER_IMAGE}). */
  image: string;
  /** Image tag (default {@link DEFAULT_IMAGE_TAG}). */
  tag: string;
}

/**
 * Resolve the runtime image name + tag ONCE from the parsed args, applying the
 * defaults. Threaded into every command (render, verify, list-versions, pull) so
 * they all target the same `<image>:<tag>`. `--runtime-image` overrides the name;
 * `--image-tag` overrides the tag (default `latest`).
 */
function resolveImageRef(parsed: RenderArgs): ImageRef {
  return {
    image: parsed.image ?? DEFAULT_DOCKER_IMAGE,
    tag: parsed.imageTag ?? DEFAULT_IMAGE_TAG,
  };
}

/**
 * Render the templated harness for `resolved` at `config`'s device dimensions and
 * theme, returning the raw render result. Centralizes the WU-1 wiring so every
 * render site (one-shot, watch, verify) passes the SAME width/height to BOTH
 * `templateHarness` (the `PREVIEW_WIDTH/HEIGHT` float literals + background) AND
 * `renderInContainer` (the `PREVIEW_WIDTH/HEIGHT` env → Xvfb screen size). The
 * resolved `imageRef` selects which runtime image+tag the container runs.
 */
/**
 * Cross-file slice (ADR-006): when the input is a FILE, collect helper/type/const
 * definitions from the project sources it `#include`s and inline them into the
 * harness `globals` slot, so a preview that USES a component defined in another file
 * still renders. Unresolved symbols get weak stubs (placeholder Views) so the render
 * never hard-fails on a missing dependency. stdin/inline inputs have no project
 * siblings, so they pass through unchanged.
 */
function computeSlice(resolved: ResolvedInput): { globals: string; body: string; heuristic: boolean; helperPaths: string[] } {
  // Strip `#include` lines from the preview BODY: a body goes inside
  // `CreatePreviewUI()`, where `#include` is invalid, and a project header
  // ("card.h") isn't in the container anyway — its definitions are inlined into
  // `globals` by the slice. System `<...>` come from the harness template. Blank
  // the line (keep the newline) so source-line numbers stay aligned.
  const stripIncludes = (s: string): string => s.replace(/^[ \t]*#include\b.*$/gm, '');
  const body = stripIncludes(resolved.code);

  const p = resolved.sourcePath;
  if (!p || p.startsWith('<') || !fs.existsSync(p)) {
    return { globals: '', body, heuristic: false, helperPaths: [] };
  }
  let fullText: string;
  try {
    fullText = fs.readFileSync(p, 'utf8');
  } catch {
    return { globals: '', body, heuristic: false, helperPaths: [] };
  }
  const extraSources = resolveProjectIncludes(p, fullText);
  const slice = buildSlice(fullText, p, body, extraSources);
  return slice.rung === 'heuristic'
    ? { globals: slice.globals, body: slice.body, heuristic: true, helperPaths: slice.sourcePaths.slice(1) }
    : { globals: '', body, heuristic: false, helperPaths: [] };
}

async function renderWithConfig(resolved: ResolvedInput, config: RenderConfig, imageRef: ImageRef) {
  const slice = computeSlice(resolved);
  const doRender = (globals: string, body: string) =>
    renderInContainer(
      templateHarness(body, {
        width: config.deviceWidth,
        height: config.deviceHeight,
        backgroundColor: config.backgroundColor,
        globals,
      }),
      {
        image: imageRef.image,
        tag: imageRef.tag,
        width: config.deviceWidth,
        height: config.deviceHeight,
      },
    );

  if (slice.heuristic && slice.globals) {
    try {
      return await doRender(slice.globals, slice.body);
    } catch (err) {
      if (err instanceof RenderError && err.phase === 'compile') {
        // If the compile error is INSIDE a collected helper file, that helper is
        // the real problem — surface it (don't mask it with the fallback's
        // misleading "X was not declared"). Otherwise the error is in the body or
        // a weak stub: fall back to the plain body so the user sees their own error.
        const inHelper = slice.helperPaths.some((sp) => err.stderr.includes(sp));
        if (!inHelper) return await doRender('', slice.body);
      }
      throw err;
    }
  }
  return doRender('', slice.body);
}

/**
 * Attach the effective render config to the ROOT node as `root.meta`
 * `{ resolution:{w,h}, theme, dpr }` (F5.2), echoing the LOGICAL values (pre-dpr
 * scaling) plus the dpr. Deterministic and additive — it adds one field and
 * touches no existing one. Returns the same node for chaining.
 */
export function attachMeta(tree: MinimalNode, config: RenderConfig): MinimalNode {
  tree.meta = {
    resolution: { w: config.resolution.w, h: config.resolution.h },
    theme: config.theme,
    dpr: config.dpr,
  };
  return tree;
}

/**
 * Select + write the single stdout emission for one render (the machine contract,
 * Inv-6). Precedence: a query flag (`--at`/`--node`) prints ONLY its lookup JSON;
 * otherwise `--format tree` prints the human box-drawing tree, and the default
 * prints the (optionally `--max-depth`/`--max-nodes`-bounded) full-tree JSON.
 * Exactly one line is written to stdout.
 */
function emitStdout(tree: MinimalNode, parsed: RenderArgs): void {
  if (parsed.at !== undefined) {
    const hit = nodeAt(tree, parsed.at.x, parsed.at.y);
    const payload = hit !== null ? toRegion(hit) : { at: [parsed.at.x, parsed.at.y], node: null };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (parsed.nodeId !== undefined) {
    const n = nodeById(tree, parsed.nodeId);
    process.stdout.write(`${JSON.stringify(n !== null ? toRegion(n) : null)}\n`);
    return;
  }
  if (parsed.format === 'tree') {
    process.stdout.write(`${formatTree(tree)}\n`);
    return;
  }
  // Default JSON. Apply the token bounds only when at least one was given so the
  // unbounded path is byte-for-byte the M1/M2 output.
  const bounded =
    parsed.maxDepth !== undefined || parsed.maxNodes !== undefined
      ? truncate(tree, { maxDepth: parsed.maxDepth, maxNodes: parsed.maxNodes })
      : tree;
  process.stdout.write(`${JSON.stringify(bounded)}\n`);
}

/**
 * Run ONE full render→emit pass: template → render in container → build the
 * annotated tree → write the file side-effects (`--overlay`/`--report`/`--image`)
 * → emit the single stdout line. Owns its own temp workDir, cleaned up in a
 * `finally` so each pass (including every watch re-render) leaves no temp dir.
 * Throws on render/IO failure so the caller decides fatal-vs-recoverable.
 *
 * `--overlay`/`--report`/`--image` are file side-effects orthogonal to stdout;
 * stdout selection is delegated to {@link emitStdout}.
 */
async function renderAndEmit(parsed: RenderArgs, resolved: ResolvedInput): Promise<void> {
  let workDir: string | undefined;
  try {
    const config = resolveRenderConfig(parsed);
    const result = await renderWithConfig(resolved, config, resolveImageRef(parsed));
    workDir = result.workDir;

    // Build the annotated canonical tree (now carrying the M2 `mark`). This is the
    // single source every surface below reads — overlay marks, --at/--node, stdout.
    // Echo the effective render config on the root (F5.2).
    const tree = attachMeta(
      buildTree(result.metadataJson, {
        sourceCode: resolved.code,
        startLine: resolved.startLine,
      }),
      config,
    );

    // --overlay writes a Set-of-Mark annotated PNG; it implies render (already
    // done) and is orthogonal to stdout (Inv-6). Written before stdout selection.
    if (parsed.overlayOut !== undefined) {
      const overlayDir = path.dirname(path.resolve(parsed.overlayOut));
      await fs.promises.mkdir(overlayDir, { recursive: true });
      await renderOverlay(result.pngPath, tree, parsed.overlayOut);
    }

    // --report writes a self-contained HTML/MD report (PNG + box-tree + node
    // table). Like --overlay it implies render and is orthogonal to stdout: the
    // JSON tree is still emitted below (the report is purely a file side-effect).
    if (parsed.reportOut !== undefined) {
      await writeReport(tree, result.pngPath, parsed.reportOut);
    }

    // The single stdout emission (the contract).
    emitStdout(tree, parsed);

    // PNG is copied out ONLY when --image was supplied; otherwise the harness's PNG
    // stays in the temp workDir and is removed by the finally cleanup below.
    if (parsed.imageOut !== undefined) {
      const destDir = path.dirname(path.resolve(parsed.imageOut));
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.copyFile(result.pngPath, parsed.imageOut);
    }
  } finally {
    if (workDir !== undefined) {
      cleanupWorkDir(workDir);
    }
  }
}

/**
 * Load a target scene tree from a `--baseline-tree` JSON file and project it
 * through {@link buildTree} so it is the SAME canonical shape as the freshly
 * rendered tree (ids/types/bounds aligned), making the id-keyed {@link treeDiff}
 * apples-to-apples. The file may be a `{ root: <node> }` wrapper or a bare node —
 * buildTree accepts both. No `sourceCode` is passed (the baseline carries its own
 * `sourceLine`s already).
 *
 * @throws  If the file is missing/unreadable or not valid tree JSON.
 */
async function loadBaselineTree(baselineTreePath: string): Promise<MinimalNode> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(baselineTreePath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read --baseline-tree '${baselineTreePath}': ${reason}`);
  }
  return buildTree(raw);
}

/**
 * The verify / update-baseline pass (M4): render ONCE, then EITHER
 *   - `--update-baseline`: write the just-rendered PNG to the `--baseline` path
 *     (and the current tree JSON to `--baseline-tree`, if given) and return 0 — no
 *     diff is computed; or
 *   - verify (`--baseline` and/or `--baseline-tree`, without --update-baseline):
 *     image-diff and/or tree-diff the render against the baseline(s), print the
 *     combined verdict JSON to stdout (REPLACING the normal tree stdout, Inv-6),
 *     and return 0 (match) or 20 (diverged).
 *
 * Owns its own temp workDir, cleaned up in a `finally` (mirrors {@link renderAndEmit}).
 * `--image` is still honoured as an orthogonal side-effect (copy the actual PNG out).
 * Throws on render/IO failure so the caller decides fatal-vs-recoverable.
 */
async function runVerifyOrUpdate(parsed: RenderArgs, resolved: ResolvedInput): Promise<number> {
  let workDir: string | undefined;
  try {
    const config = resolveRenderConfig(parsed);
    const result = await renderWithConfig(resolved, config, resolveImageRef(parsed));
    workDir = result.workDir;

    const tree = attachMeta(
      buildTree(result.metadataJson, {
        sourceCode: resolved.code,
        startLine: resolved.startLine,
      }),
      config,
    );

    // --image is an orthogonal side-effect: copy the actual render out if asked.
    if (parsed.imageOut !== undefined) {
      const destDir = path.dirname(path.resolve(parsed.imageOut));
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.copyFile(result.pngPath, parsed.imageOut);
    }

    // --update-baseline: write the current render AS the baseline(s); no diff.
    if (parsed.updateBaseline) {
      // parseRenderArgs guarantees baseline is set when updateBaseline is.
      const baselinePng = parsed.baseline as string;
      const pngDir = path.dirname(path.resolve(baselinePng));
      await fs.promises.mkdir(pngDir, { recursive: true });
      await fs.promises.copyFile(result.pngPath, baselinePng);
      if (parsed.baselineTree !== undefined) {
        const treeDir = path.dirname(path.resolve(parsed.baselineTree));
        await fs.promises.mkdir(treeDir, { recursive: true });
        await fs.promises.writeFile(parsed.baselineTree, `${JSON.stringify(tree)}\n`, 'utf8');
      }
      return 0;
    }

    // Verify: compute whichever diffs were requested, then the combined verdict.
    let image: ImageDiffResult | undefined;
    if (parsed.baseline !== undefined) {
      // Write the visual diff PNG next to the BASELINE (a persistent, user-owned
      // dir) rather than imageDiff's default location next to the actual PNG —
      // the actual lives in `workDir`, which the `finally` below deletes, leaving
      // the advertised `diffPngPath` dangling. Next-to-baseline survives cleanup,
      // so the verdict's `diffPngPath` points at a file that still exists.
      const baselinePath = parsed.baseline;
      const baseExt = path.extname(baselinePath);
      const diffPngPath = path.join(
        path.dirname(baselinePath),
        `${path.basename(baselinePath, baseExt)}.diff.png`,
      );
      image = await imageDiff(result.pngPath, baselinePath, {
        failRatio: parsed.threshold,
        diffPngPath,
      });
    }
    let treeResult: TreeDiffResult | undefined;
    if (parsed.baselineTree !== undefined) {
      const target = await loadBaselineTree(parsed.baselineTree);
      treeResult = treeDiff(tree, target);
    }

    const verdict = buildVerdict({ image, tree: treeResult });
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    return verdictExitCode(verdict);
  } finally {
    if (workDir !== undefined) {
      cleanupWorkDir(workDir);
    }
  }
}

/**
 * `--list-versions` (management, no render): merge the remote registry tags with
 * the local docker tags for the resolved `<image>`, marking each tag's
 * local/current status, and print the {@link VersionListing} JSON to STDOUT, exit
 * 0. The LOCAL part tolerates docker being down (imageManager logs a stderr note
 * and reports `local: false`), so this stays exit 0 offline-from-docker. A REGISTRY
 * failure is the only fatal case here (nothing useful to print) → exit 1 + stderr.
 */
async function runListVersions(parsed: RenderArgs): Promise<number> {
  const { image, tag } = resolveImageRef(parsed);
  try {
    const listing = await listVersions(image, tag);
    process.stdout.write(`${JSON.stringify(listing)}\n`);
    return EXIT.OK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`dali-ui-preview-cli: could not list runtime versions: ${message}`);
    return EXIT.USAGE;
  }
}

/**
 * `--pull [<tag>]` (management, no render): pull the resolved `<image>:<tag>`
 * (default tag `latest`), streaming docker's progress to STDERR, then print
 * `{"pulled":"<ref>","ok":true}` to STDOUT, exit 0. Docker being unavailable is a
 * distinct documented failure (exit 12); any other pull failure (bad tag, network)
 * is exit 11 with the error on stderr (stdout stays empty for the caller's parser).
 */
async function runPull(parsed: RenderArgs): Promise<number> {
  const { image, tag: defaultTag } = resolveImageRef(parsed);
  // `--pull` alone (or `--pull` with no tag token) defaults to 'latest'; an
  // explicit `--image-tag` is NOT used to pick the pulled tag (the positional
  // `--pull <tag>` is the selector), but `--pull` with no tag falls back to the
  // resolved default tag so `--pull` and a bare render agree on 'latest'.
  const tag = parsed.pull?.tag ?? defaultTag;
  if (!(await isDockerAvailable())) {
    console.error(
      'dali-ui-preview-cli: Docker is not available: `docker info` failed. Ensure Docker is ' +
      'installed, the daemon is running, and the current user can access the Docker socket.',
    );
    return EXIT.DOCKER_UNAVAILABLE;
  }
  try {
    const { ref } = await pullImage(image, tag);
    process.stdout.write(`${JSON.stringify({ pulled: ref, ok: true })}\n`);
    return EXIT.OK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`dali-ui-preview-cli: ${message}`);
    return EXIT.RENDER_ERROR;
  }
}

/**
 * Map a {@link RenderError}'s raw container diagnostics to the user's absolute
 * source line via the vendored gcc parser (F5.3): read the RAW harness template
 * (where `{{USER_CODE}}` still exists) to get the 1-based offset, run
 * `parseGccErrors` (which returns a 0-based user-relative line), and add
 * `resolved.startLine` (the source's absolute 0-based offset in its file) to the
 * FIRST parsed error. The public `sourceLine` contract is 1-BASED (matching the
 * tree's `sourceLine`), so `+1` is applied at this output boundary — a single-line
 * `--code` compile error (startLine 0, user line 0) reports `1`, not `0`. Returns
 * the diagnostic's message + that 1-based line, or `formatRawError(stderr)` + null
 * when nothing maps (boilerplate / render-phase).
 */
export function mapRenderError(err: RenderError, resolved: ResolvedInput): StructuredError {
  const offset = userCodeOffset();
  const parsed = parseGccErrors(err.stderr, offset);
  if (parsed.length > 0) {
    const first = parsed[0];
    return {
      phase: err.phase,
      message: first.message,
      sourceLine: first.line + (resolved.startLine ?? 0) + 1,
    };
  }
  return {
    phase: err.phase,
    message: formatRawError(err.stderr),
    sourceLine: null,
  };
}

/**
 * Decide the exit code + diagnostics for a failed render/verify pass (F5.3/F5.4):
 *   - {@link RenderError} → print the structured `{phase,message,sourceLine}` JSON
 *     to STDERR (stdout stays empty) and return 10 (compile) / 11 (render);
 *   - the docker-unavailable preflight Error → return 12;
 *   - any other Error (IO, bad metadata, …) → the pre-M5 plain stderr line + 1.
 */
function handleRenderFailure(err: unknown, resolved: ResolvedInput): number {
  if (err instanceof RenderError) {
    const structured = mapRenderError(err, resolved);
    // The structured error is the machine contract on the failure path: emit it as
    // a single JSON line to STDERR, leaving stdout empty for the caller's parser.
    console.error(JSON.stringify(structured));
    return structured.phase === 'compile' ? EXIT.COMPILE_ERROR : EXIT.RENDER_ERROR;
  }
  const message = err instanceof Error ? err.message : String(err);
  // The `docker info` preflight (dockerRunner) throws this exact plain Error; it is
  // a distinct, documented failure class (exit 12), kept separate from a usage (1)
  // or a compile/render (10/11) failure so a script can branch on it.
  if (/^Docker is not available:/.test(message)) {
    console.error(`dali-ui-preview-cli: ${message}`);
    return EXIT.DOCKER_UNAVAILABLE;
  }
  console.error(`dali-ui-preview-cli: ${message}`);
  return EXIT.USAGE;
}

/**
 * Default-command dispatch. First parses the args, then short-circuits to a
 * management command when one is set (`--list-versions` / `--pull` — these take no
 * render input). Otherwise it is the render command: resolve input (file | stdin |
 * inline) → template → render in container → build the annotated tree → select
 * stdout per the query/format flags → write the file side-effects for
 * `--image` / `--overlay` / `--report`.
 *
 * With `--watch` (FILE input only) it renders+emits once, then re-renders+re-emits
 * on every change to that file until SIGINT/SIGTERM. STDOUT carries a SINGLE
 * emission per render (JSON tree, box-tree, or a lookup result). Every diagnostic
 * goes to stderr. Returns the process exit code.
 */
async function runRender(argv: string[]): Promise<number> {
  let parsed: RenderArgs;
  try {
    parsed = parseRenderArgs(argv);
  } catch (err) {
    console.error(`dali-ui-preview-cli: ${err instanceof Error ? err.message : String(err)}`);
    console.error(USAGE);
    return EXIT.USAGE;
  }

  // Management commands (--list-versions / --pull) operate on the runtime image and
  // take NO render input, so they are dispatched here — before any input resolution.
  // parseRenderArgs guarantees they are mutually exclusive with each other and with
  // every render/verify flag. Their stdout is JSON; exit 0 on success.
  if (parsed.listVersions) {
    return runListVersions(parsed);
  }
  if (parsed.pull !== undefined) {
    return runPull(parsed);
  }

  let resolved: ResolvedInput;
  try {
    // Resolve the input source up front: an "no input given" error here must
    // surface the usage banner, exactly like an arg-parse error.
    resolved = await resolveRenderInput(parsed);
    // --watch needs a watchable FILE; the remaining unwatchable case (no
    // positional, code piped on stdin) is only detectable here, post-resolve.
    if (parsed.watch && (parsed.input === undefined || parsed.input === '-')) {
      throw new Error('--watch requires a FILE input (not stdin or --code).');
    }
  } catch (err) {
    console.error(`dali-ui-preview-cli: ${err instanceof Error ? err.message : String(err)}`);
    console.error(USAGE);
    return EXIT.USAGE;
  }

  if (resolved.code.trim().length === 0) {
    console.error('dali-ui-preview-cli: input is empty — no preview code to render.');
    return EXIT.USAGE;
  }

  // Verify / update-baseline (M4): a one-shot render whose stdout is the verdict
  // JSON (or nothing, for --update-baseline), and whose exit code is 0 = match /
  // 20 = diverged. A render/IO failure here is a TOOL error, surfaced via the M5
  // structured-error path (compile→10 / render→11 / docker→12, else 1), kept
  // distinct from the 20 "rendered, but differs" verdict. Parsed-arg validation
  // already rejected combining these flags with --watch / --at / --node / --format.
  if (parsed.updateBaseline || parsed.baseline !== undefined || parsed.baselineTree !== undefined) {
    try {
      return await runVerifyOrUpdate(parsed, resolved);
    } catch (err) {
      return handleRenderFailure(err, resolved);
    }
  }

  // --watch: an initial render+emit, then re-render on every change to the input
  // file (debounced) until interrupted. `parsed.input` is a real file path here
  // (the non-file sources were rejected above). Each pass RE-READS the file so an
  // edit is picked up; resolved is refreshed per render.
  if (parsed.watch) {
    const filePath = parsed.input as string;
    try {
      await runWatch(filePath, async () => {
        const fresh = await resolveInput(filePath);
        if (fresh.code.trim().length === 0) {
          console.error('dali-ui-preview-cli: input is empty — no preview code to render.');
          return;
        }
        await renderAndEmit(parsed, fresh);
      });
      return 0;
    } catch (err) {
      return handleRenderFailure(err, resolved);
    }
  }

  // One-shot render.
  try {
    await renderAndEmit(parsed, resolved);
    return EXIT.OK;
  } catch (err) {
    return handleRenderFailure(err, resolved);
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

  // `init` — seed the current project (AGENTS.md + Claude skill) + pull image so a
  // coding agent can verify DALi UI in its loop. Lazy-required (only when used).
  if (argv[0] === 'init') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./init').runInit(argv.slice(1));
  }

  // A bare invocation (no args) is only a usage request when stdin is an
  // interactive TTY. If code is piped in (`cat x.cpp | dali-ui-preview-cli`), fall
  // through to runRender, which reads the piped stdin code block.
  if (argv.length === 0 && process.stdin.isTTY) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // Default command: resolve input (file | stdin | --code), print the tree,
  // and write the PNG only when --image was supplied.
  return runRender(argv);
}

// Auto-run ONLY when invoked as the entry script (`out/cli.js` via the `bin`
// shim). Guarding on `require.main === module` lets the unit tests `require()`
// this module to exercise its pure helpers (e.g. mapRenderError) WITHOUT executing
// the CLI and calling `process.exit`.
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`dali-ui-preview-cli: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
