#!/usr/bin/env node
/*
 * dali-ui-preview CLI entrypoint.
 *
 * WU-1 (M0/F0.1) scope: the build must succeed and `--version` must work.
 * Render / tree wiring (the default `<input> --image <path>` command) lands in
 * later work units (WU-4/WU-5).
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): there is no vscode
 * outputChannel here, and stdout is reserved for the machine contract (later: the
 * JSON node tree). So diagnostics go to stderr via console.error; only the
 * `--version` / `--help` text legitimately prints to stdout.
 */

import * as fs from 'fs';
import * as path from 'path';

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

function main(argv: string[]): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // Render / tree path arrives in WU-4/WU-5. Until then, anything else is unknown.
  console.error(`dali-ui-preview: unrecognized arguments: ${argv.join(' ')}`);
  console.error(USAGE);
  return 1;
}

process.exit(main(process.argv.slice(2)));
