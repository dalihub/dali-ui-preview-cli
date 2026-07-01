/*
 * runtime/localRunner.ts — compile the templated DALi harness with the host
 * g++/pkg-config against a native DALi prefix and run it under a one-shot Xvfb to
 * capture the PNG + scene-tree JSON. The native sibling of dockerRunner: it returns
 * the SAME RenderResult and throws the SAME RenderError so the CLI is mode-agnostic.
 * Ported from the extension's LocalBackend (compile()/execute()).
 */
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { RenderError, RenderResult, RenderPhase } from '../dockerRunner';
import { resolvePrefix, validateDaliPrefix, checkDependencies } from './daliEnvironment';
import { startXvfb } from './xvfb';

const execAsync = promisify(exec);

/** pkg-config modules every DALi preview compile links against (verbatim from the extension). */
const DALI_PKG_MODULES = 'dali2-core dali2-adaptor dali2-ui-foundation dali2-ui-components glib-2.0';
/** Basename kept as `preview_harness.cpp` so g++ diagnostics match parseGccErrors. */
const SOURCE_NAME = 'preview_harness.cpp';
const BIN_NAME = 'preview_bin';
const DEFAULT_COMPILE_TIMEOUT_MS = 60_000;
const DEFAULT_RUN_TIMEOUT_MS = 20_000;

export interface LocalRenderOptions {
  width?: number;
  height?: number;
  timeoutMs?: number;
  daliPrefix?: string;
  baseDir?: string;
}

export interface LocalReadiness {
  ready: boolean;
  issues: string[];
  prefix: string | null;
}

/** Escape a host path for embedding inside a C++ string literal. */
export function escapeCppString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** A g++ diagnostic (`file:line:col: error:`) means compile phase; else render phase. */
function classifyPhase(diagnostics: string): RenderPhase {
  return /:\d+:\d+:\s*error:/.test(diagnostics) ? 'compile' : 'render';
}

/** Synchronous readiness probe: host build tools + a valid DALi prefix. */
export function checkLocalReadiness(opts: { daliPrefix?: string; baseDir?: string } = {}): LocalReadiness {
  const deps = checkDependencies();
  const prefix = resolvePrefix({ override: opts.daliPrefix, baseDir: opts.baseDir });
  const issues: string[] = [];
  if (!deps.gcc) { issues.push('g++ not found on PATH (sudo apt-get install build-essential).'); }
  if (!deps.pkgconfig) { issues.push('pkg-config not found on PATH (sudo apt-get install pkg-config).'); }
  if (!deps.xvfb) { issues.push('Xvfb not found on PATH (sudo apt-get install xvfb).'); }
  if (!prefix || !validateDaliPrefix(prefix)) {
    issues.push(prefix
      ? `DALi install not found at ${prefix} (missing libdali2-core.so or dali2-ui-foundation.pc).`
      : 'No DALi install found. Pass --dali-prefix <path>, set DESKTOP_PREFIX, or run `init`.');
  }
  return { ready: issues.length === 0, issues, prefix };
}

async function compile(srcPath: string, binPath: string, prefix: string, timeoutMs: number): Promise<{ ok: boolean; log: string }> {
  const pcPath = `${prefix}/lib/pkgconfig:/usr/lib/pkgconfig:/usr/share/pkgconfig`;
  const useCcache = checkDependencies().ccache;
  const compiler = useCcache ? 'ccache g++' : 'g++';
  const cmd = [
    `PKG_CONFIG_PATH="${pcPath}"`,
    `${compiler} -std=c++17 -O0`,
    `$(PKG_CONFIG_PATH="${pcPath}" pkg-config --cflags ${DALI_PKG_MODULES})`,
    `"${srcPath}"`,
    `$(PKG_CONFIG_PATH="${pcPath}" pkg-config --libs ${DALI_PKG_MODULES})`,
    `-L"${prefix}/lib" -Wl,-rpath-link,"${prefix}/lib"`,
    `-o "${binPath}"`,
  ].join(' ');
  try {
    await execAsync(cmd, { timeout: timeoutMs, shell: '/bin/bash', maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, log: '' };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    // g++ writes diagnostics to stderr; merge both so classifyPhase/parseGccErrors see them.
    return { ok: false, log: `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message || 'compile failed' };
  }
}

async function run(binPath: string, display: string, prefix: string, width: number, height: number, timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const inherited = process.env.LD_LIBRARY_PATH;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LD_LIBRARY_PATH: inherited ? `${prefix}/lib:${inherited}` : `${prefix}/lib`,
    DISPLAY: display,
    DALI_WINDOW_WIDTH: String(width),
    DALI_WINDOW_HEIGHT: String(height),
  };
  try {
    const { stdout, stderr } = await execAsync(`"${binPath}"`, { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? err.message ?? 'run failed' };
  }
}

/**
 * Compile + render `source` natively into `pngHost`/`metaHost`. Same success and
 * error contract as {@link renderInContainer}: returns a {@link RenderResult} on
 * success; throws a plain Error prefixed `Local DALi runtime is not available:`
 * when the host isn't ready (→ CLI exit 13), or a {@link RenderError} (compile /
 * render) on a real build/run failure.
 */
export async function renderNatively(source: string, workDir: string, pngHost: string, metaHost: string, opts: LocalRenderOptions = {}): Promise<RenderResult> {
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const readiness = checkLocalReadiness({ daliPrefix: opts.daliPrefix, baseDir: opts.baseDir });
  if (!readiness.ready || !readiness.prefix) {
    throw new Error(`Local DALi runtime is not available: ${readiness.issues.join(' ')}`);
  }
  const prefix = readiness.prefix;

  const srcPath = path.join(workDir, SOURCE_NAME);
  const binPath = path.join(workDir, BIN_NAME);
  await fs.promises.writeFile(srcPath, source, 'utf8');
  try { fs.unlinkSync(binPath); } catch { /* no stale binary */ }

  const c = await compile(srcPath, binPath, prefix, opts.timeoutMs ?? DEFAULT_COMPILE_TIMEOUT_MS);
  if (!c.ok) {
    throw new RenderError(`Native compile failed.\n${c.log}`, c.log, 2, classifyPhase(c.log));
  }

  const xvfb = await startXvfb(width, height);
  if (!xvfb) {
    throw new RenderError(
      'Local preview needs a virtual display (Xvfb) but none could start — refusing to render on the real display. Install Xvfb (sudo apt-get install -y xvfb).',
      '', 3, 'render');
  }
  let outcome: { ok: boolean; stdout: string; stderr: string };
  try {
    outcome = await run(binPath, xvfb.display, prefix, width, height, DEFAULT_RUN_TIMEOUT_MS);
  } finally {
    xvfb.stop();
  }

  const diagnostics = [outcome.stdout, outcome.stderr].map((s) => s.trim()).filter((s) => s.length > 0).join('\n');
  const cleanStdout = outcome.stdout.replace(/\x1b?\[[0-9;]*[a-zA-Z]/g, '');
  const sawOk = /(^|\n)\s*OK:/.test(cleanStdout);
  if (!outcome.ok || !sawOk) {
    throw new RenderError(`Native render failed${sawOk ? '' : ' (no OK: marker)'}.${diagnostics ? `\n${diagnostics}` : ''}`,
      diagnostics, outcome.ok ? 0 : 4, 'render');
  }
  if (!fs.existsSync(pngHost)) {
    throw new RenderError(`Binary reported OK but no PNG at ${pngHost}.`, diagnostics, 0, 'render');
  }
  let metadataJson: string | null = null;
  try { metadataJson = await fs.promises.readFile(metaHost, 'utf8'); } catch { metadataJson = null; }

  return { pngPath: pngHost, metadataPath: metaHost, metadataJson, stdout: outcome.stdout, stderr: outcome.stderr, workDir };
}
