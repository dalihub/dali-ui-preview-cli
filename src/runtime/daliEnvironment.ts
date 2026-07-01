/*
 * runtime/daliEnvironment.ts — locate + validate a native DALi install for local
 * rendering, and probe host build tools. Ported from the VS Code extension's
 * daliEnvironment.ts, minus the `vscode`/ConfigurationService dependency: the CLI
 * gets its override from a flag/env/config instead of a workspace setting.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { readConfig } from './config';

const UI_FOUNDATION_PC = path.join('lib', 'pkgconfig', 'dali2-ui-foundation.pc');
const CORE_LIB = path.join('lib', 'libdali2-core.so');

/** True iff `prefix` has both libdali2-core.so and the dali2-ui-foundation .pc. */
export function validateDaliPrefix(prefix: string): boolean {
  try {
    return fs.existsSync(path.join(prefix, CORE_LIB)) && fs.existsSync(path.join(prefix, UI_FOUNDATION_PC));
  } catch {
    return false;
  }
}

/**
 * Resolve the actual DALi prefix at or just below a folder. Accepts the prefix
 * directly, a parent containing `dali-env/opt` or `opt`, or one directory level
 * down — so picking a project/home folder still works. Returns null if none found.
 */
export function resolveDaliPrefix(candidate: string): string | null {
  for (const c of [candidate, path.join(candidate, 'dali-env', 'opt'), path.join(candidate, 'opt')]) {
    if (validateDaliPrefix(c)) { return c; }
  }
  try {
    for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
      if (!entry.isDirectory()) { continue; }
      for (const sub of [
        path.join(candidate, entry.name, 'dali-env', 'opt'),
        path.join(candidate, entry.name, 'opt'),
      ]) {
        if (validateDaliPrefix(sub)) { return sub; }
      }
    }
  } catch { /* not a readable dir */ }
  return null;
}

export interface HostDeps { gcc: boolean; xvfb: boolean; pkgconfig: boolean; ccache: boolean }

function has(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Probe the host for the tools a native compile+render needs. */
export function checkDependencies(): HostDeps {
  return { gcc: has('g++'), xvfb: has('Xvfb'), pkgconfig: has('pkg-config'), ccache: has('ccache') };
}

function parseSetenv(file: string): string | null {
  try {
    if (!fs.existsSync(file)) { return null; }
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.trim().match(/^(?:export\s+)?DESKTOP_PREFIX\s*=\s*["']?([^"'\s#]+)["']?/);
      if (m && m[1]) {
        let v = m[1];
        if (v.startsWith('~')) { v = path.join(process.env.HOME || '', v.slice(1)); }
        return v;
      }
    }
  } catch { /* unreadable */ }
  return null;
}

function pkgConfigPrefix(): string | null {
  try {
    const out = execSync('pkg-config --variable=prefix dali2-ui-foundation', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    return out.length > 0 ? out : null;
  } catch { return null; }
}

/**
 * Resolve a native DALi prefix by precedence, returning the first that validates:
 *   override → DALI_PREVIEW_PREFIX env → .dali/config.json → DESKTOP_PREFIX env →
 *   <baseDir>/setenv → pkg-config system prefix → common paths.
 * Each candidate is passed through {@link resolveDaliPrefix}. Returns null if none.
 */
export function resolvePrefix(opts: { override?: string; baseDir?: string } = {}): string | null {
  const baseDir = opts.baseDir ?? process.cwd();
  const candidates: (string | null | undefined)[] = [
    opts.override,
    process.env.DALI_PREVIEW_PREFIX,
    readConfig(baseDir).daliPrefix,
    process.env.DESKTOP_PREFIX,
    parseSetenv(path.join(baseDir, 'setenv')),
    pkgConfigPrefix(),
    '/opt/dali', '/opt/dali/opt', '/usr/local', '/usr',
  ];
  for (const c of candidates) {
    if (!c || c.trim().length === 0) { continue; }
    const resolved = resolveDaliPrefix(c.trim());
    if (resolved) { return resolved; }
  }
  return null;
}
