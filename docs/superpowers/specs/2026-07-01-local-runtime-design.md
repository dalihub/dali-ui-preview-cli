# Design — Local (native) runtime for dali-ui-preview-cli

## 한 줄 요약 (TL;DR)

`dali-ui-preview-cli` is **Docker-only** today. This adds a **local (native) runtime**
path so a host with a built DALi prefix + `g++`/`pkg-config`/`Xvfb` can render without
Docker. Docker stays the **default** (zero behavior change); local is **opt-in** via
`--runtime local` / `DALI_PREVIEW_RUNTIME=local` / a persisted `.dali/config.json`, and
`init` detects + configures + smoke-renders whichever runtime is available. The render
result contract (`RenderResult`, `RenderError`, exit codes, stdout JSON) is **identical**
across both modes, so every downstream surface (tree, overlay, verify, diff) is unchanged.

| | Docker (today, default) | Local (new, opt-in) |
|---|---|---|
| Prereq | Docker daemon + runtime image (~290 MB) | Native DALi prefix + `g++`/`pkg-config`/`Xvfb` |
| Determinism | pinned image, `llvmpipe` software raster | host DALi build + host fonts/GPU (may drift) |
| Selection | default | `--runtime local` \| env \| `.dali/config.json` |
| Unavailable exit | `12` (unchanged) | **`13`** (new) |
| Use case | anyone, reproducible | uifw devs who rebuild DALi and want fresh `.so` |

---

## 1. Problem & goal

The VS Code extension (`paperclip`) supports **both** a Docker backend and a native
`LocalBackend` (compile with host `g++`/`pkg-config` against a DALi prefix, run under a
host-managed `Xvfb`). The standalone CLI shipped only `dockerRunner.ts` — no native path.

**Goal:** give the CLI the same choice, so a developer/agent on a host with a native DALi
build can render natively. Requirements (from the requester):

1. Docker path must keep working **unchanged** (backward compatible).
2. An AI agent must be able to **set up and select** local runtime easily.
3. **Both** render paths verified end-to-end (real renders), robust tests.
4. Docs + agent skills updated for local mode.
5. Honest completion report; the human decides release.

## 2. Key facts that shape the design

- The **harness binary itself** writes the PNG (to the baked `{{OUTPUT_PATH}}`) and the
  scene-tree JSON (to `{{METADATA_PATH}}`), and prints `OK:<png>` on success — identical
  in Docker and native. So a local runner only needs to **compile + run under Xvfb**; the
  output contract falls out for free. (`server/preview_harness.cpp.template`.)
- `harnessTemplater.templateHarness()` already accepts `outputPath` / `metadataPath`
  overrides (default `/work/preview.png` / `/work/tree.json`). Local mode just bakes
  **host** paths instead of container `/work/...` paths.
- The single render call site is `renderWithConfig()` (`cli.ts`) → `renderInContainer()`.
  That is the only place to branch on runtime mode.
- The extension's proven native commands (to port, minus `vscode`):
  - **Compile:** `PKG_CONFIG_PATH="<prefix>/lib/pkgconfig:/usr/lib/pkgconfig:/usr/share/pkgconfig" [ccache] g++ -std=c++17 -O0 $(pkg-config --cflags <MODULES>) <src> $(pkg-config --libs <MODULES>) -L"<prefix>/lib" -Wl,-rpath-link,"<prefix>/lib" -o <bin>` with `MODULES = dali2-core dali2-adaptor dali2-ui-foundation dali2-ui-components glib-2.0`.
  - **Run:** env `LD_LIBRARY_PATH=<prefix>/lib[:inherited]`, `DISPLAY=<xvfb>`,
    `DALI_WINDOW_WIDTH/HEIGHT`; success requires `OK:` on stdout + PNG present.
  - **Xvfb:** claim a free display `:99..:114`, `-screen 0 <W>x<H>x24 -ac -nolisten tcp`,
    wait via `xdpyinfo`, **never** fall back to the real display `:0`.
- The CLI is an **independent git repo** (`dalihub/dali-ui-preview-cli`), mocha+c8 unit
  tests, no render tests in CI today.
- **ADR-002** originally rejected native-on-host for determinism; the extension later added
  `LocalBackend` anyway for uifw devs. This CLI change mirrors that: Docker stays the
  deterministic default; local is an explicit developer opt-in. Documented as a caveat.

## 3. Architecture — approach B (parallel runner + thin dispatcher)

Chosen over (A) a full `BuildBackend` class hierarchy (over-engineered for the CLI's
function-first style) and (C) `xvfb-run` (extra dependency, weak control). Approach B keeps
the `RenderResult` contract identical so nothing downstream changes.

```
cli.ts
 └─ resolveRuntimeMode(parsed)   # --runtime | --local | DALI_PREVIEW_RUNTIME | .dali/config.json | default 'docker'
 └─ render(mode, userCode, templateOpts, renderOpts)     ← new dispatcher (render.ts)
      1) mkdtemp workDir
      2) per-mode embed/host paths
           docker: embed=/work/preview.png,       host=<workDir>/preview.png
           local : embed=host=<workDir>/preview.png   (C++-escaped)
      3) templateHarness(userCode, { ...templateOpts, outputPath, metadataPath })
      4) branch:
           docker → renderInContainerAt(source, workDir, opts)   (existing logic, workDir injected)
           local  → renderNatively(source, workDir, pngHost, metaHost, opts)   (new)
      5) both return the SAME RenderResult { pngPath, metadataPath, metadataJson, stdout, stderr, workDir }
```

Below `render()`, the mode is invisible; upstream tree-build / overlay / verify / diff are untouched.

## 4. New files (`src/runtime/`)

| File | Responsibility |
|---|---|
| `daliEnvironment.ts` | Port of prefix detect/validate (no `vscode`). CLI resolution order: `--dali-prefix` → `DALI_PREVIEW_PREFIX` env → `.dali/config.json` `daliPrefix` → `DESKTOP_PREFIX` env → workspace `setenv` file → `pkg-config --variable=prefix dali2-ui-foundation` → common paths (`/opt/dali`, `/usr/local`, `/usr`). Plus `validateDaliPrefix`, `resolveDaliPrefix`, `checkDependencies` (g++/Xvfb/pkg-config/ccache). |
| `xvfb.ts` | One-shot Xvfb helper: claim free display `:99..:114`, screen sized to the render, wait via `xdpyinfo`, run a callback with `DISPLAY` set, then kill. Never returns `:0`. |
| `localRunner.ts` | `renderNatively(source, workDir, pngHost, metaHost, opts): Promise<RenderResult>` — native compile (exact extension flags) + Xvfb run; throws the same `RenderError` (`phase: 'compile' \| 'render'`). `isLocalRuntimeReady()` preflight (deps + prefix) returning actionable issues; on unavailable, throws a plain `Error` prefixed `Local DALi runtime is not available:` (mapped to exit 13). |
| `config.ts` | Read/write `.dali/config.json`: `{ runtime?: 'docker' \| 'local', daliPrefix?: string, imageTag?: string }`. Found by walking up from cwd to the project root (folder with `.git`/`package.json`), like the slicer's root detection. |

## 5. Modified files

- **`dockerRunner.ts`** — extract `renderInContainerAt(source, workDir, opts)` (workDir
  injected, embed paths already baked by the caller). Keep `renderInContainer` as a thin
  back-compat wrapper (creates its own workDir + default `/work` paths) so existing tests
  and any external callers are unaffected.
- **`render.ts`** (new, or a small section of cli.ts) — `resolveRuntimeMode()` + `render()`
  dispatcher described in §3.
- **`cli.ts`**
  - New flags following the existing `--image-tag` else-if/validation pattern:
    `--runtime <docker|local>`, `--local` (shorthand for `--runtime local`),
    `--dali-prefix <path>`.
  - Route `renderWithConfig()` through `render(mode, …)`.
  - New exit code **`13 = RUNTIME_UNAVAILABLE`** (selected local runtime missing deps/prefix).
    `12` stays Docker-unavailable. `handleRenderFailure` maps the
    `Local DALi runtime is not available:` message → 13.
  - **Smart hint:** when Docker is unavailable (would exit 12) **and** a valid local
    prefix + deps are detected, append to stderr: “Docker unavailable, but a local DALi
    runtime looks ready at `<prefix>` — retry with `--runtime local`.”
  - Update `USAGE`.
- **`init.ts`** — detect **both** runtimes; pick per precedence (explicit `--runtime` →
  else Docker if available → else local if ready); persist the choice to `.dali/config.json`;
  smoke-render in the chosen mode (Docker pull only when Docker chosen). Emit the
  runtime-specific setup guidance.

## 6. Docs & agent skills

Update: `README.md`, `README.ko.md`, `skills/dali-preview/SKILL.md`,
`templates/agent-verification-loop.md`, `docs/agent-enablement.md`, `CHANGELOG.md`.
Add a “choose your runtime” section (Docker default vs local opt-in), the setup steps for
local (`--dali-prefix` / `DESKTOP_PREFIX` / `init`), exit code **13**, and the determinism +
**font caveat** (local uses host fontconfig — CJK can render as tofu if fonts are missing;
Docker bakes `fonts-noto-cjk`).

## 7. `--list-versions` / `--pull`

Docker-image management — remain Docker-specific and keep working regardless of mode.
Documented as N/A for local rendering (local has no image to version/pull).

## 8. Testing (both paths verified end-to-end)

**Unit (mocha + c8, matching existing conventions in `src/test/unit/`):**
- `daliEnvironment` — prefix resolution precedence, `validateDaliPrefix`, `resolveDaliPrefix`,
  `checkDependencies` (deps injected/mocked).
- `config` — read/write/merge of `.dali/config.json`, precedence vs flags/env.
- `resolveRuntimeMode` + arg parsing — flag/env/config/default precedence; dup/leading-dash
  rejection for the new flags.
- `localRunner` — error classification (`compile` vs `render`) on synthetic diagnostics;
  unavailable-runtime error shape (→ exit 13).
- `xvfb` — display-claim logic with a mocked spawner (no real Xvfb in unit).

**E2E (real renders — opt-in scripts, not github CI; run on this host during verification):**
- `test:e2e:local` — render `samples/hello-dali.preview.dali.cpp` + a `samples/showcase`
  sample **natively** against the real prefix
  (`/home/woochan/tizen/generativeUI/dali-env/opt`); assert exit 0, a **non-blank** PNG
  (size + not-all-one-color), and a valid parseable tree JSON with a non-trivial node count.
- `test:e2e:docker` — same samples via Docker (existing runtime image); same assertions.
- **Parity** — same input through both modes yields **structurally** equivalent trees
  (same node types/roles/hierarchy). Pixel-exact PNG parity is **not** asserted across modes
  (host font/GPU drift is expected and documented).

## 9. Out of scope

- Resident preview-server fast path for local mode (the extension has it; the CLI is
  one-shot per render — a fresh process already picks up a rebuilt `.so`).
- Cross-mode pixel-identical goldens / `--baseline` portability across Docker↔local
  (documented caveat; baselines are mode-specific).

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Host DALi prefix older than harness API (`AddChildren`) → compile skew | Verified the target host prefix has `AddChildren`; `validate()` surfaces prefix issues; compile error maps to source line as usual. |
| Rendering on the real display `:0` (visible window) | `xvfb.ts` never returns `:0`; render is blocked with an actionable error if no virtual display. |
| Behavior drift in the copied docker logic | `renderInContainer` kept as a thin wrapper over the extracted `renderInContainerAt`; existing tests guard it. |
| Font tofu / visual drift in local mode | Documented caveat; structural (not pixel) parity asserted in tests. |
