# CLI Local (native) Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native (local) render path to `dali-ui-preview-cli` so a host with a built DALi prefix + `g++`/`pkg-config`/`Xvfb` can render without Docker, selectable per invocation, env, or a persisted `.dali/config.json`; Docker stays the default.

**Architecture:** A thin `render(mode, …)` dispatcher owns the temp workDir + harness templating and branches to the existing Docker runner or a new native runner. Both return the identical `RenderResult`, so every downstream surface (tree/overlay/verify/diff) is untouched. The native runner ports the extension's proven `g++`/`pkg-config` + `Xvfb` logic minus `vscode`.

**Tech Stack:** TypeScript (strict), Node `child_process`, mocha + c8 tests, `g++`/`pkg-config`/`Xvfb`/`xdpyinfo` on the host, the vendored DALi harness template.

## Global Constraints

- Docker remains the **default** runtime; no existing behavior changes when no runtime flag/env/config is set.
- `RenderResult` shape (`{ pngPath, metadataPath, metadataJson, stdout, stderr, workDir }`) and `RenderError` (`{ stderr, exitCode, phase: 'compile'|'render' }`) are the contract both runners honor.
- Exit codes: keep `0/1/10/11/12/20`; **add `13 = RUNTIME_UNAVAILABLE`** for a selected-but-unavailable local runtime. `12` stays Docker-unavailable.
- pkg-config modules (verbatim): `dali2-core dali2-adaptor dali2-ui-foundation dali2-ui-components glib-2.0`.
- Native compile (verbatim flags): `[ccache] g++ -std=c++17 -O0 $(pkg-config --cflags <MODULES>) <src> $(pkg-config --libs <MODULES>) -L"<prefix>/lib" -Wl,-rpath-link,"<prefix>/lib" -o <bin>` with `PKG_CONFIG_PATH="<prefix>/lib/pkgconfig:/usr/lib/pkgconfig:/usr/share/pkgconfig"`.
- Native run env: `LD_LIBRARY_PATH=<prefix>/lib[:inherited]`, `DISPLAY=<xvfb>`, `DALI_WINDOW_WIDTH/HEIGHT`. Success = `OK:` on stdout **and** PNG present. **Never** render on `:0`.
- TS style: single quotes, `const` over `let`, `async/await`, no `console.log` on the stdout contract path (stdout is the JSON tree; diagnostics → stderr).
- Config file: `.dali/config.json`, shape `{ runtime?: 'docker'|'local', daliPrefix?: string, imageTag?: string }`, located by walking up from the input dir (or cwd) to the project root (`.git`/`package.json`) via the existing `findProjectRoot`.

---

### Task 1: `.dali/config.json` read/write (`runtime/config.ts`)

**Files:**
- Create: `src/runtime/config.ts`
- Test: `src/test/unit/runtimeConfig.test.ts`

**Interfaces:**
- Consumes: `findProjectRoot(startDir: string): string` from `../sliceSources`.
- Produces:
  - `interface DaliConfig { runtime?: 'docker' | 'local'; daliPrefix?: string; imageTag?: string }`
  - `function readConfig(baseDir: string): DaliConfig` — walk to project root, read `.dali/config.json`; `{}` if absent/malformed (never throws).
  - `function writeConfig(projectRoot: string, cfg: DaliConfig): string` — write pretty JSON to `<projectRoot>/.dali/config.json` (mkdir -p), return the file path.

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readConfig, writeConfig } from '../../runtime/config';

describe('runtime/config', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-cfg-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{}'); // marks project root
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('returns {} when no config exists', () => {
    expect(readConfig(root)).to.deep.equal({});
  });

  it('round-trips a written config found from a nested dir', () => {
    const p = writeConfig(root, { runtime: 'local', daliPrefix: '/opt/dali' });
    expect(fs.existsSync(p)).to.equal(true);
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    expect(readConfig(nested)).to.deep.equal({ runtime: 'local', daliPrefix: '/opt/dali' });
  });

  it('returns {} for malformed JSON instead of throwing', () => {
    fs.mkdirSync(path.join(root, '.dali'), { recursive: true });
    fs.writeFileSync(path.join(root, '.dali', 'config.json'), '{ not json');
    expect(readConfig(root)).to.deep.equal({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/runtimeConfig.test.js`
Expected: FAIL — `Cannot find module '../../runtime/config'`.

- [ ] **Step 3: Write minimal implementation**

```ts
/*
 * runtime/config.ts — read/write the project's .dali/config.json, the persisted
 * runtime choice (docker|local), DALi prefix, and default image tag. Located by
 * walking up to the project root (.git/package.json) like the slicer.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findProjectRoot } from '../sliceSources';

export interface DaliConfig {
  runtime?: 'docker' | 'local';
  daliPrefix?: string;
  imageTag?: string;
}

const CONFIG_REL = path.join('.dali', 'config.json');

/** Read `.dali/config.json` from the project root at/above `baseDir`. Never throws;
 *  returns `{}` when the file is absent or malformed. */
export function readConfig(baseDir: string): DaliConfig {
  try {
    const root = findProjectRoot(baseDir);
    const file = path.join(root, CONFIG_REL);
    if (!fs.existsSync(file)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      const out: DaliConfig = {};
      if (parsed.runtime === 'docker' || parsed.runtime === 'local') { out.runtime = parsed.runtime; }
      if (typeof parsed.daliPrefix === 'string') { out.daliPrefix = parsed.daliPrefix; }
      if (typeof parsed.imageTag === 'string') { out.imageTag = parsed.imageTag; }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/** Write `.dali/config.json` under `projectRoot` (mkdir -p). Returns the file path. */
export function writeConfig(projectRoot: string, cfg: DaliConfig): string {
  const dir = path.join(projectRoot, '.dali');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return file;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha out/test/unit/runtimeConfig.test.js`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/config.ts src/test/unit/runtimeConfig.test.ts
git commit -m "feat(runtime): read/write .dali/config.json runtime choice"
```

---

### Task 2: DALi environment detection (`runtime/daliEnvironment.ts`)

**Files:**
- Create: `src/runtime/daliEnvironment.ts`
- Test: `src/test/unit/daliEnvironment.test.ts`

**Interfaces:**
- Consumes: `DaliConfig`/`readConfig` from `./config`.
- Produces:
  - `function validateDaliPrefix(prefix: string): boolean` — true iff `<prefix>/lib/libdali2-core.so` AND `<prefix>/lib/pkgconfig/dali2-ui-foundation.pc` exist.
  - `function resolveDaliPrefix(candidate: string): string | null` — accept the prefix, or a parent containing `dali-env/opt`/`opt`, or one level down.
  - `interface HostDeps { gcc: boolean; xvfb: boolean; pkgconfig: boolean; ccache: boolean }`
  - `function checkDependencies(): HostDeps` — sync `which` probes.
  - `function resolvePrefix(opts: { override?: string; baseDir?: string }): string | null` — precedence: `override` → `DALI_PREVIEW_PREFIX` env → config `daliPrefix` → `DESKTOP_PREFIX` env → `<baseDir>/setenv` → `pkg-config --variable=prefix dali2-ui-foundation` → common paths (`/opt/dali`, `/opt/dali/opt`, `/usr/local`, `/usr`). Each candidate passed through `resolveDaliPrefix`; returns the first that validates, else null.

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateDaliPrefix, resolveDaliPrefix, resolvePrefix, checkDependencies } from '../../runtime/daliEnvironment';

function fakePrefix(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-prefix-'));
  const lib = path.join(root, 'lib');
  fs.mkdirSync(path.join(lib, 'pkgconfig'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'libdali2-core.so'), '');
  fs.writeFileSync(path.join(lib, 'pkgconfig', 'dali2-ui-foundation.pc'), '');
  return root;
}

describe('runtime/daliEnvironment', () => {
  it('validateDaliPrefix requires core lib + ui-foundation pc', () => {
    const p = fakePrefix();
    expect(validateDaliPrefix(p)).to.equal(true);
    expect(validateDaliPrefix(path.join(p, 'nope'))).to.equal(false);
  });

  it('resolveDaliPrefix accepts a parent that holds dali-env/opt', () => {
    const inner = fakePrefix();                 // acts as the "opt" prefix
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-parent-'));
    const target = path.join(parent, 'dali-env', 'opt');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(inner, target, { recursive: true });
    expect(resolveDaliPrefix(parent)).to.equal(target);
  });

  it('resolvePrefix honors an explicit override first', () => {
    const p = fakePrefix();
    expect(resolvePrefix({ override: p })).to.equal(p);
    expect(resolvePrefix({ override: path.join(p, 'bad') })).to.not.equal(path.join(p, 'bad'));
  });

  it('checkDependencies reports booleans for the four tools', () => {
    const d = checkDependencies();
    expect(d).to.have.all.keys('gcc', 'xvfb', 'pkgconfig', 'ccache');
    expect(d.gcc).to.be.a('boolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/daliEnvironment.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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

export function validateDaliPrefix(prefix: string): boolean {
  try {
    return fs.existsSync(path.join(prefix, CORE_LIB)) && fs.existsSync(path.join(prefix, UI_FOUNDATION_PC));
  } catch {
    return false;
  }
}

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

/** Resolve a native DALi prefix by precedence, returning the first that validates. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha out/test/unit/daliEnvironment.test.js`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/daliEnvironment.ts src/test/unit/daliEnvironment.test.ts
git commit -m "feat(runtime): native DALi prefix detection + host dep probes"
```

---

### Task 3: One-shot Xvfb helper (`runtime/xvfb.ts`)

**Files:**
- Create: `src/runtime/xvfb.ts`
- Test: `src/test/unit/xvfb.test.ts`

**Interfaces:**
- Produces:
  - `interface XvfbSession { display: string; stop(): void }`
  - `async function startXvfb(width: number, height: number): Promise<XvfbSession | null>` — claim a free display in `:99..:114`, `-screen 0 <W>x<H>x24 -ac -nolisten tcp`, wait until `xdpyinfo` succeeds (≤5s), return the session; `null` if none could start (caller must then refuse to render — never `:0`).
  - `function isXvfbInstalled(): boolean`

- [ ] **Step 1: Write the failing test** (unit test asserts the guard contract without spawning a real server)

```ts
import { expect } from 'chai';
import { isXvfbInstalled } from '../../runtime/xvfb';

describe('runtime/xvfb', () => {
  it('isXvfbInstalled returns a boolean (never throws)', () => {
    expect(isXvfbInstalled()).to.be.a('boolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/xvfb.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/*
 * runtime/xvfb.ts — one-shot virtual display for a single native render. Claims a
 * free display in :99..:114 (a wide band so leftover servers can't force us onto
 * the real :0), starts Xvfb, waits until it answers, and hands back a stop().
 * Ported from the extension's XvfbManager, simplified for a short-lived CLI.
 */
import { spawn, execSync, ChildProcess } from 'child_process';

const CANDIDATES = Array.from({ length: 16 }, (_, i) => 99 + i); // :99 … :114

export interface XvfbSession { display: string; stop(): void }

export function isXvfbInstalled(): boolean {
  try { execSync('which Xvfb', { stdio: 'ignore' }); return true; } catch { return false; }
}

function inUse(n: number): boolean {
  try {
    const lock = `/tmp/.X${n}-lock`;
    const fs = require('fs');
    if (!fs.existsSync(lock)) { return false; }
    const pid = parseInt(String(fs.readFileSync(lock, 'utf8')).trim(), 10);
    if (Number.isNaN(pid)) { return false; }
    try { process.kill(pid, 0); return true; } catch { return false; }
  } catch { return false; }
}

function ready(display: string): boolean {
  try { execSync(`xdpyinfo -display ${display}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

async function tryStart(display: string, width: number, height: number): Promise<ChildProcess | null> {
  const child = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-ac', '-nolisten', 'tcp'],
    { stdio: 'ignore', detached: true });
  child.unref();
  let died = false;
  child.on('error', () => { died = true; });
  child.on('exit', () => { died = true; });
  for (let i = 0; i < 50; i++) {                 // up to ~5s
    if (died) { return null; }
    if (ready(display)) { return child; }
    await new Promise((r) => setTimeout(r, 100));
  }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  return null;
}

/** Start a virtual display sized to the render. Returns null if none could start. */
export async function startXvfb(width: number, height: number): Promise<XvfbSession | null> {
  if (!isXvfbInstalled()) { return null; }
  const w = Math.max(1, Math.min(width, 8192));
  const h = Math.max(1, Math.min(height, 8192));
  for (const n of CANDIDATES) {
    const display = `:${n}`;
    if (inUse(n)) { continue; }
    const child = await tryStart(display, w, h);
    if (child) {
      return {
        display,
        stop() { try { child.kill('SIGTERM'); } catch { /* already gone */ } },
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha out/test/unit/xvfb.test.js`
Expected: PASS (1 passing).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/xvfb.ts src/test/unit/xvfb.test.ts
git commit -m "feat(runtime): one-shot Xvfb helper (never falls back to :0)"
```

---

### Task 4: Native runner (`runtime/localRunner.ts`)

**Files:**
- Create: `src/runtime/localRunner.ts`
- Modify: `src/dockerRunner.ts` — export the shared render types so the local runner reuses them (no duplication).
- Test: `src/test/unit/localRunner.test.ts`

**Interfaces:**
- Consumes: `RenderResult`, `RenderError`, `RenderPhase` from `../dockerRunner`; `resolvePrefix`, `validateDaliPrefix`, `checkDependencies` from `./daliEnvironment`; `startXvfb` from `./xvfb`.
- Produces:
  - `interface LocalRenderOptions { width?: number; height?: number; timeoutMs?: number; daliPrefix?: string; baseDir?: string }`
  - `interface LocalReadiness { ready: boolean; issues: string[]; prefix: string | null }`
  - `function checkLocalReadiness(opts?: { daliPrefix?: string; baseDir?: string }): LocalReadiness` — sync; deps + prefix.
  - `async function renderNatively(source: string, workDir: string, pngHost: string, metaHost: string, opts?: LocalRenderOptions): Promise<RenderResult>` — writes `source` to `<workDir>/preview_harness.cpp`, compiles, runs under Xvfb, returns `RenderResult`. Throws a plain `Error` prefixed `Local DALi runtime is not available:` when not ready; throws `RenderError` (`compile`/`render`) on compile/run failure.
  - `function escapeCppString(s: string): string` (exported for the dispatcher to bake host paths).

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkLocalReadiness, renderNatively, escapeCppString } from '../../runtime/localRunner';
import { RenderError } from '../../dockerRunner';

describe('runtime/localRunner', () => {
  it('escapeCppString escapes backslashes and quotes', () => {
    expect(escapeCppString('a\\b"c')).to.equal('a\\\\b\\"c');
  });

  it('renderNatively throws a runtime-unavailable Error when prefix is bogus', async () => {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-'));
    try {
      await renderNatively('int main(){}', wd, path.join(wd, 'p.png'), path.join(wd, 't.json'),
        { daliPrefix: path.join(wd, 'no-dali') });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).to.match(/^Local DALi runtime is not available:/);
    } finally {
      fs.rmSync(wd, { recursive: true, force: true });
    }
  });

  it('checkLocalReadiness reports issues (not ready) for a bogus prefix', () => {
    const r = checkLocalReadiness({ daliPrefix: '/definitely/not/dali' });
    expect(r.ready).to.equal(false);
    expect(r.issues.join(' ')).to.match(/DALi/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/localRunner.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3a: Export shared types from `dockerRunner.ts`**

Confirm `RenderResult`, `RenderError`, `RenderPhase`, `RenderOptions` are already `export`ed (they are). No code change needed beyond importing them in the local runner. (This step is a verification step — grep to confirm.)

Run: `grep -nE "export (class RenderError|interface RenderResult|type RenderPhase)" src/dockerRunner.ts`
Expected: three matches.

- [ ] **Step 3b: Write the native runner**

```ts
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
const SOURCE_NAME = 'preview_harness.cpp';   // basename keeps g++ diagnostics matchable by parseGccErrors
const BIN_NAME = 'preview_bin';
const DEFAULT_COMPILE_TIMEOUT_MS = 60_000;
const DEFAULT_RUN_TIMEOUT_MS = 20_000;

export interface LocalRenderOptions { width?: number; height?: number; timeoutMs?: number; daliPrefix?: string; baseDir?: string }
export interface LocalReadiness { ready: boolean; issues: string[]; prefix: string | null }

export function escapeCppString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function classifyPhase(diagnostics: string): RenderPhase {
  return /:\d+:\d+:\s*error:/.test(diagnostics) ? 'compile' : 'render';
}

/** Synchronous readiness probe: host tools + a valid DALi prefix. */
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

/** Compile + render `source` natively into `pngHost`/`metaHost`. Same contract as renderInContainer. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha out/test/unit/localRunner.test.js`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/localRunner.ts src/test/unit/localRunner.test.ts
git commit -m "feat(runtime): native compile+Xvfb runner (RenderResult parity)"
```

---

### Task 5: Refactor `dockerRunner` to inject workDir (`renderInContainerAt`)

**Files:**
- Modify: `src/dockerRunner.ts`
- Test: `src/test/unit/dockerRunnerRefactor.test.ts` (structure-only; no daemon)

**Interfaces:**
- Produces:
  - `async function renderInContainerAt(templatedSource: string, workDir: string, opts?: RenderOptions): Promise<RenderResult>` — same as `renderInContainer` but uses a caller-provided `workDir` (already created) instead of `mkdtemp`.
  - `renderInContainer(templatedSource, opts?)` retained: thin wrapper that mkdtemps a workDir then delegates to `renderInContainerAt` (behavior unchanged).

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from 'chai';
import * as dr from '../../dockerRunner';

describe('dockerRunner refactor', () => {
  it('exposes renderInContainerAt alongside renderInContainer', () => {
    expect(dr.renderInContainerAt).to.be.a('function');
    expect(dr.renderInContainer).to.be.a('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/dockerRunnerRefactor.test.js`
Expected: FAIL — `renderInContainerAt` is undefined.

- [ ] **Step 3: Refactor**

In `src/dockerRunner.ts`, split `renderInContainer` so the workDir is a parameter. Replace the body of the current function with:

```ts
export async function renderInContainer(templatedSource: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-ui-preview-'));
  return renderInContainerAt(templatedSource, workDir, opts);
}

export async function renderInContainerAt(templatedSource: string, workDir: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const image = opts.image ?? DEFAULT_DOCKER_IMAGE;
  const tag = opts.tag ?? DEFAULT_IMAGE_TAG;
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ref = imageRef(image, tag);

  if (!(await isDockerAvailable())) {
    throw new Error(
      'Docker is not available: `docker info` failed. Ensure Docker is ' +
      'installed, the daemon is running, and the current user can access ' +
      'the Docker socket.',
    );
  }

  const sourcePathHost = path.join(workDir, SOURCE_NAME);
  await fs.promises.writeFile(sourcePathHost, templatedSource, 'utf8');
  // ... (the remainder of the current renderInContainer body, unchanged, from the
  //      `const args = [ ... ]` line through the final `return { ... }`.)
}
```

Concretely: move everything after the original `writeFile(sourcePathHost, …)` line into `renderInContainerAt`, and delete the original `mkdtempSync` line from that function (it now lives in the wrapper). Keep `SOURCE_NAME`, `PNG_NAME`, `TREE_NAME`, and the `docker run` args exactly as they are (`/work/${SOURCE_NAME}`, reading `<workDir>/preview.png` + `<workDir>/tree.json`).

- [ ] **Step 4: Run tests to verify pass (refactor test + full suite unchanged)**

Run: `npm run build && npm run test:unit`
Expected: PASS — all existing tests still green + the new refactor test.

- [ ] **Step 5: Commit**

```bash
git add src/dockerRunner.ts src/test/unit/dockerRunnerRefactor.test.ts
git commit -m "refactor(docker): extract renderInContainerAt (workDir injected)"
```

---

### Task 6: Render dispatcher + runtime-mode resolution (`render.ts`)

**Files:**
- Create: `src/render.ts`
- Test: `src/test/unit/renderDispatch.test.ts`

**Interfaces:**
- Consumes: `templateHarness` from `./harnessTemplater`; `renderInContainerAt`, `RenderResult`, `RenderOptions` from `./dockerRunner`; `renderNatively`, `escapeCppString` from `./runtime/localRunner`; `readConfig` from `./runtime/config`.
- Produces:
  - `type RuntimeMode = 'docker' | 'local'`
  - `function resolveRuntimeMode(opts: { flag?: RuntimeMode; baseDir?: string }): RuntimeMode` — precedence: `flag` → `DALI_PREVIEW_RUNTIME` env (only `docker`/`local`) → config `runtime` → `'docker'`.
  - `interface DispatchTemplateOpts { width: number; height: number; backgroundColor: string; globals?: string }`
  - `interface DispatchRenderOpts { image?: string; tag?: string; width: number; height: number; timeoutMs?: number; daliPrefix?: string; baseDir?: string }`
  - `async function render(mode: RuntimeMode, userCode: string, t: DispatchTemplateOpts, r: DispatchRenderOpts): Promise<RenderResult>` — owns the workDir, computes per-mode embed/host paths, templates, dispatches. Returns `RenderResult`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from 'chai';
import { resolveRuntimeMode } from '../../render';

describe('resolveRuntimeMode', () => {
  const saved = process.env.DALI_PREVIEW_RUNTIME;
  afterEach(() => { if (saved === undefined) { delete process.env.DALI_PREVIEW_RUNTIME; } else { process.env.DALI_PREVIEW_RUNTIME = saved; } });

  it('defaults to docker', () => {
    delete process.env.DALI_PREVIEW_RUNTIME;
    expect(resolveRuntimeMode({ baseDir: '/tmp' })).to.equal('docker');
  });
  it('flag beats env', () => {
    process.env.DALI_PREVIEW_RUNTIME = 'docker';
    expect(resolveRuntimeMode({ flag: 'local', baseDir: '/tmp' })).to.equal('local');
  });
  it('env selects local when no flag', () => {
    process.env.DALI_PREVIEW_RUNTIME = 'local';
    expect(resolveRuntimeMode({ baseDir: '/tmp' })).to.equal('local');
  });
  it('ignores a bogus env value', () => {
    process.env.DALI_PREVIEW_RUNTIME = 'banana';
    expect(resolveRuntimeMode({ baseDir: '/tmp' })).to.equal('docker');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/renderDispatch.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the dispatcher**

```ts
/*
 * render.ts — runtime-mode resolution + the single render dispatcher. Owns the
 * temp workDir and harness templating, then branches to the Docker or native
 * runner. Both return the identical RenderResult, so callers stay mode-agnostic.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { templateHarness } from './harnessTemplater';
import { renderInContainerAt, RenderResult } from './dockerRunner';
import { renderNatively, escapeCppString } from './runtime/localRunner';
import { readConfig } from './runtime/config';

export type RuntimeMode = 'docker' | 'local';

export function resolveRuntimeMode(opts: { flag?: RuntimeMode; baseDir?: string } = {}): RuntimeMode {
  if (opts.flag === 'docker' || opts.flag === 'local') { return opts.flag; }
  const env = process.env.DALI_PREVIEW_RUNTIME;
  if (env === 'docker' || env === 'local') { return env; }
  const cfg = readConfig(opts.baseDir ?? process.cwd()).runtime;
  if (cfg === 'docker' || cfg === 'local') { return cfg; }
  return 'docker';
}

export interface DispatchTemplateOpts { width: number; height: number; backgroundColor: string; globals?: string }
export interface DispatchRenderOpts { image?: string; tag?: string; width: number; height: number; timeoutMs?: number; daliPrefix?: string; baseDir?: string }

export async function render(mode: RuntimeMode, userCode: string, t: DispatchTemplateOpts, r: DispatchRenderOpts): Promise<RenderResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-ui-preview-'));
  const pngHost = path.join(workDir, 'preview.png');
  const metaHost = path.join(workDir, 'tree.json');

  if (mode === 'local') {
    const source = templateHarness(userCode, {
      width: t.width, height: t.height, backgroundColor: t.backgroundColor, globals: t.globals,
      outputPath: escapeCppString(pngHost), metadataPath: escapeCppString(metaHost),
    });
    return renderNatively(source, workDir, pngHost, metaHost, {
      width: t.width, height: t.height, timeoutMs: r.timeoutMs, daliPrefix: r.daliPrefix, baseDir: r.baseDir,
    });
  }

  // docker: harness bakes the container /work paths; workDir is bind-mounted at /work.
  const source = templateHarness(userCode, {
    width: t.width, height: t.height, backgroundColor: t.backgroundColor, globals: t.globals,
    outputPath: '/work/preview.png', metadataPath: '/work/tree.json',
  });
  return renderInContainerAt(source, workDir, {
    image: r.image, tag: r.tag, width: r.width, height: r.height, timeoutMs: r.timeoutMs,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha out/test/unit/renderDispatch.test.js`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/test/unit/renderDispatch.test.ts
git commit -m "feat(render): runtime-mode dispatcher (docker|local) with shared workDir"
```

---

### Task 7: Wire the CLI — flags, routing, exit 13, smart hint, USAGE

**Files:**
- Modify: `src/cli.ts`
- Test: `src/test/unit/cliRuntimeArgs.test.ts`

**Interfaces:**
- Consumes: `render`, `resolveRuntimeMode`, `RuntimeMode` from `./render`; `checkLocalReadiness` from `./runtime/localRunner`.
- Produces (exported for tests): the extended `parseRenderArgs` accepting `--runtime`, `--local`, `--dali-prefix`; `RenderArgs` gains `runtime?: RuntimeMode` and `daliPrefix?: string`; `EXIT.RUNTIME_UNAVAILABLE = 13`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from 'chai';
import { parseRenderArgs } from '../../cli';

describe('cli runtime args', () => {
  it('parses --runtime local', () => {
    expect(parseRenderArgs(['a.cpp', '--runtime', 'local']).runtime).to.equal('local');
  });
  it('--local is shorthand for --runtime local', () => {
    expect(parseRenderArgs(['a.cpp', '--local']).runtime).to.equal('local');
  });
  it('parses --dali-prefix', () => {
    expect(parseRenderArgs(['a.cpp', '--dali-prefix', '/opt/dali']).daliPrefix).to.equal('/opt/dali');
  });
  it('rejects a bad --runtime value', () => {
    expect(() => parseRenderArgs(['a.cpp', '--runtime', 'podman'])).to.throw(/docker.*local/);
  });
  it('rejects --runtime + --local conflict when they disagree', () => {
    expect(() => parseRenderArgs(['a.cpp', '--runtime', 'docker', '--local'])).to.throw(/runtime/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/cliRuntimeArgs.test.js`
Expected: FAIL — `runtime`/`daliPrefix` undefined; unknown option `--runtime`.

- [ ] **Step 3a: Extend `EXIT`, `RenderArgs`, imports**

In `src/cli.ts`: add to the `EXIT` object `RUNTIME_UNAVAILABLE: 13,`. Add to `RenderArgs`:

```ts
  /** Runtime mode from `--runtime docker|local` / `--local` (default resolved later). */
  runtime?: RuntimeMode;
  /** Native DALi prefix from `--dali-prefix <path>` (local mode only). */
  daliPrefix?: string;
```

Add imports near the top:

```ts
import { render, resolveRuntimeMode, RuntimeMode } from './render';
import { checkLocalReadiness } from './runtime/localRunner';
```

- [ ] **Step 3b: Parse the new flags**

In `parseRenderArgs`, add locals `let runtime: RuntimeMode | undefined; let daliPrefix: string | undefined;` and, following the `--runtime-image` else-if block, insert:

```ts
    } else if (arg === '--runtime') {
      const value = argv[i + 1];
      if (value !== 'docker' && value !== 'local') {
        throw new Error("--runtime requires a value of 'docker' or 'local'.");
      }
      if (runtime !== undefined && runtime !== value) {
        throw new Error('conflicting runtime: --runtime and --local disagree.');
      }
      runtime = value;
      i++; // consume the value
    } else if (arg === '--local') {
      if (runtime === 'docker') {
        throw new Error('conflicting runtime: --runtime docker and --local disagree.');
      }
      runtime = 'local';
    } else if (arg === '--dali-prefix') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--dali-prefix requires a path argument.');
      }
      if (daliPrefix !== undefined) {
        throw new Error('--dali-prefix was specified more than once.');
      }
      daliPrefix = value;
      i++; // consume the value
    }
```

Add `runtime, daliPrefix,` to the returned object literal. (Order note: place the `--local` branch **before** the generic `else if (arg.startsWith('-'))` catch-all, i.e. inside the same chain — it already is.)

- [ ] **Step 3c: Thread mode through the render sites**

Add a small resolver + change `renderWithConfig` to accept it. Replace the `renderWithConfig` signature and body's `renderInContainer(...)` call:

```ts
/** Everything the render dispatcher needs, resolved once from parsed args + input. */
interface RuntimeContext { mode: RuntimeMode; image: string; tag: string; daliPrefix?: string; baseDir: string }

function resolveRuntimeContext(parsed: RenderArgs, resolved: ResolvedInput): RuntimeContext {
  const baseDir = resolved.sourcePath && !resolved.sourcePath.startsWith('<')
    ? path.dirname(path.resolve(resolved.sourcePath)) : process.cwd();
  const ref = resolveImageRef(parsed);
  return { mode: resolveRuntimeMode({ flag: parsed.runtime, baseDir }), image: ref.image, tag: ref.tag, daliPrefix: parsed.daliPrefix, baseDir };
}
```

Then change `renderWithConfig(resolved, config, imageRef)` → `renderWithConfig(resolved, config, ctx: RuntimeContext)`, and inside it replace the `doRender` body:

```ts
  const doRender = (globals: string, body: string) =>
    render(ctx.mode, body,
      { width: config.deviceWidth, height: config.deviceHeight, backgroundColor: config.backgroundColor, globals },
      { image: ctx.image, tag: ctx.tag, width: config.deviceWidth, height: config.deviceHeight, daliPrefix: ctx.daliPrefix, baseDir: ctx.baseDir });
```

Update the two call sites (`renderAndEmit` and `runVerifyOrUpdate`): replace `resolveImageRef(parsed)` argument with `resolveRuntimeContext(parsed, resolved)`.

- [ ] **Step 3d: Exit 13 + smart hint in `handleRenderFailure`**

Make `handleRenderFailure` async and add the local branches. Replace it with:

```ts
async function handleRenderFailure(err: unknown, resolved: ResolvedInput): Promise<number> {
  if (err instanceof RenderError) {
    const structured = mapRenderError(err, resolved);
    console.error(JSON.stringify(structured));
    return structured.phase === 'compile' ? EXIT.COMPILE_ERROR : EXIT.RENDER_ERROR;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/^Local DALi runtime is not available:/.test(message)) {
    console.error(`dali-ui-preview-cli: ${message}`);
    return EXIT.RUNTIME_UNAVAILABLE;
  }
  if (/^Docker is not available:/.test(message)) {
    console.error(`dali-ui-preview-cli: ${message}`);
    const baseDir = resolved.sourcePath && !resolved.sourcePath.startsWith('<')
      ? path.dirname(path.resolve(resolved.sourcePath)) : process.cwd();
    const local = checkLocalReadiness({ baseDir });
    if (local.ready && local.prefix) {
      console.error(`dali-ui-preview-cli: a local DALi runtime looks ready at ${local.prefix} — retry with \`--runtime local\`.`);
    }
    return EXIT.DOCKER_UNAVAILABLE;
  }
  console.error(`dali-ui-preview-cli: ${message}`);
  return EXIT.USAGE;
}
```

Then `await` it at the three call sites in `runRender` (`return await handleRenderFailure(err, resolved);`).

- [ ] **Step 3e: USAGE text**

Add three lines to the `USAGE` string (after the `--image-tag` line):

```
  '       dali-ui-preview-cli <input.cpp> --runtime docker|local  (render backend; default docker)\n' +
  '       dali-ui-preview-cli <input.cpp> --local                 (shorthand for --runtime local)\n' +
  '       dali-ui-preview-cli <input.cpp> --dali-prefix <path>     (native DALi install for --runtime local)\n' +
```

- [ ] **Step 4: Run the full suite**

Run: `npm run build && npm run test:unit`
Expected: PASS — all existing + new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/test/unit/cliRuntimeArgs.test.ts
git commit -m "feat(cli): --runtime/--local/--dali-prefix, exit 13, docker→local hint"
```

---

### Task 8: `init` — detect both runtimes, persist choice, smoke-render

**Files:**
- Modify: `src/init.ts`
- Test: `src/test/unit/initRuntime.test.ts`

**Interfaces:**
- Consumes: `checkLocalReadiness` from `./runtime/localRunner`; `writeConfig` from `./runtime/config`; `findProjectRoot` from `./sliceSources`.
- Produces: `function chooseRuntime(opts: { flagged?: 'docker' | 'local'; dockerOk: boolean; localReady: boolean }): 'docker' | 'local' | null` — pure selection: flagged wins; else docker if available; else local if ready; else null (neither).

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from 'chai';
import { chooseRuntime } from '../../init';

describe('init chooseRuntime', () => {
  it('honors an explicit flag', () => {
    expect(chooseRuntime({ flagged: 'local', dockerOk: true, localReady: false })).to.equal('local');
  });
  it('prefers docker when available and unflagged', () => {
    expect(chooseRuntime({ dockerOk: true, localReady: true })).to.equal('docker');
  });
  it('falls back to local when docker is absent', () => {
    expect(chooseRuntime({ dockerOk: false, localReady: true })).to.equal('local');
  });
  it('returns null when neither is available', () => {
    expect(chooseRuntime({ dockerOk: false, localReady: false })).to.equal(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha out/test/unit/initRuntime.test.js`
Expected: FAIL — `chooseRuntime` is not exported.

- [ ] **Step 3: Implement `chooseRuntime` + wire into `runInit`**

Add to `src/init.ts`:

```ts
/** Pick the runtime for `init`: an explicit flag wins; else docker if available;
 *  else local if ready; else null (neither usable — write docs, skip render). */
export function chooseRuntime(opts: { flagged?: 'docker' | 'local'; dockerOk: boolean; localReady: boolean }): 'docker' | 'local' | null {
  if (opts.flagged === 'docker' || opts.flagged === 'local') { return opts.flagged; }
  if (opts.dockerOk) { return 'docker'; }
  if (opts.localReady) { return 'local'; }
  return null;
}
```

Then, in `runInit`, after `writeSkill(dir)` and BEFORE the docker-only block, add runtime detection + persistence + a mode-aware smoke render. Replace the existing docker preflight/pull/smoke section with:

```ts
  const flagged = argv.includes('--local') ? 'local'
    : (argv.includes('--docker') ? 'docker' : undefined);
  const dockerOk = (await run('docker', ['info'])).code === 0;
  const local = checkLocalReadiness({ baseDir: dir });
  const mode = chooseRuntime({ flagged, dockerOk, localReady: local.ready });

  if (mode === null) {
    console.log('');
    console.log('⚠️  No runtime ready yet. Either:');
    console.log('   • install Docker, then:  dali-ui-preview-cli --pull');
    console.log('   • or install a native DALi prefix + g++/Xvfb/pkg-config and re-run with --local.');
    if (local.issues.length) { console.log(`   local checks: ${local.issues.join(' ')}`); }
    console.log('   The instruction files are in place — your agent can render once a runtime is ready.');
    return 0;
  }

  const root = findProjectRoot(dir);
  const cfg: DaliConfig = { runtime: mode };
  if (mode === 'local' && local.prefix) { cfg.daliPrefix = local.prefix; }
  const cfgPath = writeConfig(root, cfg);
  console.log(`  wrote ${path.relative(dir, cfgPath) || cfgPath}  (runtime: ${mode}${mode === 'local' && local.prefix ? `, prefix ${local.prefix}` : ''})`);

  if (mode === 'docker') {
    console.log('');
    console.log('Pulling the runtime image (first time ~290 MB, cached after)…');
    const pull = await run(process.execPath, [CLI_JS, '--pull']);
    if (pull.code !== 0) { console.log(`⚠️  image pull failed (retry with --pull):\n${pull.out.trim().slice(0, 1200)}`); return 0; }
    console.log('  ✓ runtime image ready');
  }

  if (!skipRender) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-init-'));
    const png = path.join(tmp, 'hello.png');
    const sample = path.join(PKG_ROOT, 'samples', 'hello-dali.preview.dali.cpp');
    console.log(`Smoke-rendering the hello sample (${mode})…`);
    const r = await run(process.execPath, [CLI_JS, sample, '--runtime', mode, '--image', png]);
    console.log(r.code === 0 && fs.existsSync(png) ? '  ✓ render OK' : `  ⚠️ smoke render failed:\n${r.out.trim().slice(0, 1200)}`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
```

Add the imports at the top of `init.ts`:

```ts
import { checkLocalReadiness } from './runtime/localRunner';
import { writeConfig, DaliConfig } from './runtime/config';
import { findProjectRoot } from './sliceSources';
```

(`--no-render` still works via the existing `skipRender`. A new optional `--docker` flag forces docker in `init`.)

- [ ] **Step 4: Run tests**

Run: `npm run build && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/init.ts src/test/unit/initRuntime.test.ts
git commit -m "feat(init): detect docker+local, persist choice, mode-aware smoke render"
```

---

### Task 9: Docs + agent skills

**Files:**
- Modify: `README.md`, `README.ko.md`, `skills/dali-preview/SKILL.md`, `templates/agent-verification-loop.md`, `docs/agent-enablement.md`, `CHANGELOG.md`

No test cycle (docs). Update each to cover: choosing a runtime (Docker default vs `--runtime local`), local setup (native DALi prefix via `--dali-prefix` / `DESKTOP_PREFIX` / `init`), exit code **13**, and the determinism + **font caveat** (local uses host fontconfig; CJK may tofu without `fonts-noto-cjk`; `--baseline` pixel checks are mode-specific). Keep the existing Docker guidance; add local as a peer path.

- [ ] **Step 1: Update `skills/dali-preview/SKILL.md`** — add a "Runtime: Docker (default) or local" subsection under Setup; extend the exit-code line with `13 local runtime unavailable`; add local setup one-liner (`--runtime local --dali-prefix <path>`, or `init` persists it).
- [ ] **Step 2: Update `templates/agent-verification-loop.md`** — mirror the SKILL.md runtime section (this is the AGENTS.md block `init` writes).
- [ ] **Step 3: Update `README.md` + `README.ko.md`** — add a "Runtimes" section (Docker default; local opt-in with prereqs + caveats); note `--list-versions`/`--pull` are Docker-specific.
- [ ] **Step 4: Update `docs/agent-enablement.md`** — document `init`'s runtime detection + `.dali/config.json`.
- [ ] **Step 5: Update `CHANGELOG.md`** — a `feat: local (native) runtime` entry.
- [ ] **Step 6: Commit**

```bash
git add README.md README.ko.md skills/dali-preview/SKILL.md templates/agent-verification-loop.md docs/agent-enablement.md CHANGELOG.md
git commit -m "docs: local runtime — selection, setup, exit 13, determinism caveat"
```

---

### Task 10: End-to-end verification — both runtimes render for real

**Files:**
- Create: `tests/e2e/render-modes.sh` (bash harness — real renders, opt-in, not github CI)
- Modify: `package.json` — add `test:e2e:local`, `test:e2e:docker` scripts

**Interfaces:** none (integration).

- [ ] **Step 1: Write the e2e harness**

```bash
#!/usr/bin/env bash
# tests/e2e/render-modes.sh <docker|local> — real render of the bundled samples in
# the given runtime. Asserts exit 0, a non-blank PNG, and a valid tree JSON with a
# non-trivial node count. Not run in github CI (needs a real runtime).
set -euo pipefail
MODE="${1:?usage: render-modes.sh <docker|local>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/out/cli.js"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "E2E FAIL ($MODE): $*" >&2; exit 1; }

for sample in "$ROOT/samples/hello-dali.preview.dali.cpp"; do
  png="$TMP/$(basename "$sample").png"
  echo "· rendering $(basename "$sample") [$MODE]"
  tree="$(node "$CLI" "$sample" --runtime "$MODE" --image "$png")" || fail "non-zero exit"
  [ -s "$png" ] || fail "PNG missing/empty: $png"
  # non-blank: more than one distinct color (ImageMagick if present, else size heuristic)
  if command -v identify >/dev/null 2>&1; then
    colors="$(identify -format '%k' "$png")"; [ "$colors" -gt 1 ] || fail "PNG is a single flat color"
  else
    bytes="$(stat -c%s "$png")"; [ "$bytes" -gt 2000 ] || fail "PNG suspiciously small ($bytes bytes)"
  fi
  echo "$tree" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s);const n=(x)=>1+(x.children||[]).reduce((a,c)=>a+n(c),0);if(n(t)<2)process.exit(3);})' || fail "tree JSON invalid or too few nodes"
  echo "  ✓ $MODE render OK ($(basename "$sample"))"
done
echo "E2E PASS ($MODE)"
```

- [ ] **Step 2: Add package scripts**

In `package.json` `scripts`:

```json
    "test:e2e:local": "npm run build && bash tests/e2e/render-modes.sh local",
    "test:e2e:docker": "npm run build && bash tests/e2e/render-modes.sh docker",
```

- [ ] **Step 3: Run BOTH e2e for real (this host has docker + a native prefix)**

Run:
```bash
chmod +x tests/e2e/render-modes.sh
DALI_PREVIEW_PREFIX=/home/woochan/tizen/generativeUI/dali-env/opt npm run test:e2e:local
npm run test:e2e:docker
```
Expected: `E2E PASS (local)` and `E2E PASS (docker)`.

- [ ] **Step 4: Parity smoke — same input, structurally similar trees**

Run:
```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --runtime docker  > "$TMPDIR/d.json"
DALI_PREVIEW_PREFIX=/home/woochan/tizen/generativeUI/dali-env/opt node out/cli.js samples/hello-dali.preview.dali.cpp --runtime local > "$TMPDIR/l.json"
node -e 'const a=require("fs");const t=p=>JSON.parse(a.readFileSync(p));const types=x=>[x.type,...(x.children||[]).flatMap(types)];const d=types(t(process.argv[1])),l=types(t(process.argv[2]));if(JSON.stringify(d)!==JSON.stringify(l)){console.error("type sequences differ\nD:",d,"\nL:",l);process.exit(1)}console.log("parity OK",d.length,"nodes")' "$TMPDIR/d.json" "$TMPDIR/l.json"
```
Expected: `parity OK <n> nodes` (pixel parity NOT asserted — documented drift).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/render-modes.sh package.json
git commit -m "test(e2e): real render of both runtimes + structural parity"
```

---

## Self-Review

**Spec coverage:**
- §3 dispatcher → Task 6. §4 `daliEnvironment`/`xvfb`/`localRunner`/`config` → Tasks 2/3/4/1. §5 dockerRunner refactor + cli.ts + init.ts → Tasks 5/7/8. §6 docs/skills → Task 9. §7 list-versions/pull (docker-only) → covered by not touching them + Task 9 note. §8 tests → each task's unit tests + Task 10 e2e/parity. §10 risks → Xvfb `:0` guard (Task 3), thin-wrapper back-compat (Task 5), font caveat (Task 9), prefix skew (Task 4 `validate`). All covered.

**Placeholder scan:** No TBD/TODO; every code step carries full code; the one "remainder unchanged" reference in Task 5 explicitly points at the existing lines to move (a mechanical extraction, not omitted logic).

**Type consistency:** `RenderResult`/`RenderError` reused from `dockerRunner` throughout (Tasks 4/6). `RuntimeMode` defined in `render.ts` (Task 6), imported by `cli.ts` (Task 7). `DaliConfig` defined in Task 1, consumed in Tasks 2/8. `checkLocalReadiness`/`renderNatively`/`escapeCppString` names identical across Tasks 4/6/7/8. `resolveRuntimeMode({flag,baseDir})` signature identical in Tasks 6/7.
