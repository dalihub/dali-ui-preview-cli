# Changelog

## [0.11.1] - 2026-07-09

### Added
- **dali-ui runtime-skew detector + stale-runtime hint.** A shared, curly-quote-safe signature (`src/skewSignature.ts`, byte-identical to the extension's) flags a compile failure caused by a dali-ui API a stale runtime image no longer has — matching any missing member on a **qualified `Dali::` type** (dali-core/adaptor/ui, e.g. `Dali::Actor`/`Dali::Window`, not just `Dali::Ui::`). `errorParser` appends an actionable "refresh the runtime image" hint on such failures (previously the CLI had no skew detection at all).
- **On-screen bounds check over the rich tree** (`src/onScreenCheck.ts`), wired into the render e2e (`tests/e2e/assert-render.js`): fails if a drawn node's exported `bounds` land at a negative/off-screen position — the click-to-code coordinate-correctness invariant. Test-path only; does not affect normal renders or exit codes.

## [0.11.0] - 2026-07-09

### Added
- **Cross-registry download fallback.** The runtime-image registry is auto-detected (BART GHCR proxy on the Samsung corp network, else GHCR). This composes ON TOP of the existing same-registry *tag* fallback (rolling → newest immutable): each registry is tried with the tag fallback, and if the resolved registry fails ENTIRELY — e.g. the Docker daemon can't reach or trust the BART host, which the tag fallback can't fix — the pull now falls back to the OTHER registry (BART⇄GHCR, identical repo path/digests) and `docker tag`s the fallback image to the resolved name so later renders reuse it with no second download. Applies to both `--pull` and the render auto-pull. `--pull` JSON now includes `source` (the host that served the image).
- **Detailed, per-registry download-failure guidance.** On total failure the CLI prints, per server tried, WHY it failed and HOW to fix it — host-aware (internal BART must be reached DIRECTLY, bypassing the corporate web proxy; ghcr.io through it), with `cert`/`dns`/`network`/`auth`/`notfound` categories. Shared logic with the VS Code extension so both tools diagnose identically.

## [0.10.5] - 2026-07-08

### Changed
- Agent skill accuracy pass: a value/component in a SEPARATE module/library (different build unit, `-I`/`<system>` include, outside the project) is NOT resolved by the source slicer → grey placeholder (a full-build previewer like Compose resolves cross-module; this one does not — inline or relative-`#include` it). Clarify that the fundamental limits (real/async data, DI-built view-models) are inherent to sandboxed static preview — the same in Jetpack Compose Preview — so inject sample data.

## [0.10.4] - 2026-07-08

### Changed
- Agent skill: document which cross-file forms the preview inlines (namespace/const/constexpr constants + View-returning free functions via relative `#include`) vs. what silently becomes a grey placeholder (`#define` macros, multi-line inits, non-relative/system includes, out-of-project symbols); add guidance for screens that cannot render faithfully; note dali-ui 2.5.28.

## [0.10.3] - 2026-07-08

### Fixed

- **Upgrading over a previously-broken install no longer leaves a non-executable CLI.** The common
  real-world path — a user who already installed a broken pre-0.10.2 build runs the same
  `npm i -g github:dalihub/dali-ui-preview-cli` to get the new version — took npm's "changed 1
  package" reify path rather than a fresh "added" one. That path replaced the old dangling symlink
  with a real directory (good) but did **not** set the executable bit on the `bin` target, so
  `out/cli.js` landed as `0644` and running `dali-ui-preview-cli` failed with **`Permission
  denied`**. Root cause: `out/cli.js` was committed to git as mode `100644`; only a clean install
  re-chmods it. It is now committed as **`100755`**, so the packed tarball carries the executable
  bit and the CLI works regardless of whether npm takes the added-or-changed path (verified:
  broken-0.10.1 → this version upgrade now yields an executable, runnable CLI).

## [0.10.2] - 2026-07-07

### Fixed

- **`npm i -g github:dalihub/dali-ui-preview-cli` now installs a working CLI instead of a broken
  symlink.** After 0.10.1 removed the `prepare` build hook, npm still refused to install cleanly:
  the command printed `added N packages` and exited 0, but `dali-ui-preview-cli` was then
  `command not found`. Root cause: the package.json had a top-level **`build`** script. npm treats
  a git-installed package that has `scripts.build` as a build-from-source checkout, and under the
  default `install-links=false` it *links* the transient git clone into the global `node_modules`
  rather than packing it — so once npm cleans the clone, the global `bin` symlink dangles. The
  `build` script is renamed to **`compile`** (all internal/CI/hook/README references updated), which
  avoids the heuristic entirely. The documented one-liner now yields a runnable CLI on a clean
  machine (npm 10 & 11) with no flags. A `scripts["//"]` note guards against re-adding `build`.

## [0.10.1] - 2026-07-07

### Fixed

- **`npm i -g github:dalihub/dali-ui-preview-cli` no longer fails with `tsc: not found` on the
  corp network.** The package built itself on install via a `prepare` → `tsc` step, which
  needs the `typescript` **devDependency** — but the corporate npm installs with
  `omit=dev`/production, so `tsc` was absent and the install died (agents then fell back to a
  manual `git clone` + build). The compiled output (`out/`) is now **committed to the repo**
  and the install-time build hook (`prepare`) is **removed**, so a GitHub-clone install needs
  **no build step and no build toolchain** — only the two runtime deps (`pngjs`, `pixelmatch`).
  Verified: a `--omit=dev` install runs `--version` with no `tsc` present. A `.githooks/pre-commit`
  rebuilds `out/` when `src/` changes so the committed output never drifts (enable with
  `git config core.hooksPath .githooks`).

## [0.10.0] - 2026-07-07

### Added

- **Automatic fallback from an unpullable rolling tag to the newest immutable version — the
  corp-proxy `latest` problem.** On the corp BART/Artifactory proxy a *mutable* tag (`latest`,
  and the moving `dali_X.Y.Z`) can't be served from cache: the proxy must revalidate it against
  ghcr.io on every pull, and that upstream round-trip fails over the restricted corporate egress.
  An *immutable* `dali_X.Y.Z-<sha>` (the SAME image digest) never moves, so it is served straight
  from cache — which is why `latest` fails there while a concrete `dali_2.5.28-<sha>` succeeds.
  Now, when a rolling tag can't be pulled, the CLI resolves the newest **immutable** tag from the
  registry, pulls it, and pins it to `.dali/config.json` (`imageTag`) so later renders reuse it.
  This applies to BOTH `--pull` and a bare render (`docker run`'s implicit pull is pre-empted by
  an explicit ensure step, so an agent that renders directly self-heals without running `--pull`
  first). A no-op when the image is already local. An *immutable* tag failing is still surfaced as
  a real error (no fallback). `--pull`'s JSON reports `requestedTag` + `pinnedTag` when it fell back.
- `resolveImageRefAuto` now honors a `imageTag` pinned in `.dali/config.json` (an explicit
  `--image-tag` still overrides it), so the pinned immutable tag is reused with no re-probe.

## [0.9.2] - 2026-07-07

### Fixed

- **A bare render / `--pull` now auto-detects the registry (BART proxy on the corp network,
  else GHCR) — no `init` required.** Previously only `dali-ui-preview-cli init` probed BART
  and persisted it to `.dali/config.json`; a render or `--pull` run *without* `init` fell
  through to the direct GHCR default and, inside the Samsung network, intermittently timed out
  on the throttled GHCR blob pull. The render/pull path now mirrors the VS Code extension
  (which auto-detects on every activation): when no image is configured (flag / `DALI_PREVIEW_IMAGE`
  / `.dali/config.json`) it probes once, uses the BART proxy when reachable, and **persists the
  result** so later renders and `doctor` reuse it with no re-probe. `doctor` stays network-free
  (reads config); the first render is what persists the detected registry.

### Added

- **The render log now reports which dali-ui version actually rendered**, for both runtimes,
  on **stderr** (stdout stays the JSON contract):
  `dali-ui runtime: 2.5.28  (docker · <image>:<tag> — GHCR/BART)` or
  `dali-ui runtime: 2.5.28  (local · <prefix>)`. Docker reads the `io.dalihub.dali.version`
  image label (offline, no container run; falls back to a `dali_x.y.z` tag, else `unknown`);
  local runs `pkg-config --modversion` against the native prefix — so a stale local prefix
  (e.g. an old `2.0.0` build vs the code's `2.5.28`) is now visible at a glance.

## [0.9.1] - 2026-07-07

### Added

- **Fail fast on an unsupported host OS.** The CLI runs on **Linux (x86-64) only** (it shells
  out to a Linux Docker runtime, or native `g++`/`Xvfb`). On a non-Linux host it now stops
  immediately with a clear message and **exit `14`** instead of a confusing downstream
  docker/Xvfb error. `--version`/`--help` still work anywhere. **WSL2 reports as `linux`, so
  Windows-via-WSL2 is unaffected.** (Pure `unsupportedPlatformMessage()` guard, unit-tested.)

### Docs

- **Prerequisites corrected and made explicit (README EN/KO).** States Linux-only up front,
  documents **Windows → WSL2 (Ubuntu) + Docker**, and fixes the Node wording: **Node 18 LTS is
  recommended**, not a hard requirement — it's the declared `engines` floor (supported-LTS
  policy); the code targets ES2020 and uses no Node-18-only APIs, so 14+ likely works but is
  unsupported. Also notes **git** is needed for the GitHub-clone install. Exit-code tables now
  list `14`.

## [0.9.0] - 2026-07-07

### Changed

- **Distribution is now GitHub-clone only — the CLI is intentionally not published to npm.**
  Inside the Samsung corp network both public npm and `github.com` are proxied/gated, and the
  install path verified to work in-house is a GitHub-clone install. All guides now lead with
  it: **install once** with `npm i -g github:dalihub/dali-ui-preview-cli` and run the bare
  `dali-ui-preview-cli` in the render loop (fast, no re-clone per render, no temp-file
  buildup); **one-shot** with `npx -y github:dalihub/dali-ui-preview-cli …`. Updated the
  README (EN/KO), the `AGENTS.md` verification-loop template, and the `dali-preview` skill.
  The runtime-image delivery (docker pull of GHCR/BART) is unchanged. See
  `docs/autoplan/adr/ADR-006-distribution-channel.md` (Update 2026-07-07).

### Added

- **`init` now appends `.dali/` to the project's `.gitignore`** (idempotent — creates the file
  if absent, skips if already ignored) so render PNGs and the machine/network-specific
  `.dali/config.json` don't get committed. The agent guides also tell the agent to keep render
  outputs under `.dali/` and reuse a fixed filename instead of spraying new files each loop.

## [0.8.1] - 2026-07-07

### Changed

- **Verified compatible with the new dali-ui `v2.5.28` runtime** (`latest` now tracks
  `dali_2.5.28`). The CLI harness compiles and renders unchanged on 2.5.28 — it only ever
  emitted `UiConfig::New().Apply()` (never the removed `SetAlwaysShowFocus`), so the
  breaking change that hit the VS Code extension's focus harness did not affect the CLI.
  Docs updated to reference `dali_2.5.28`. (The extension's focus-ring harness was migrated
  separately; see the extension changelog.)

## [0.8.0] - 2026-07-06

### Changed

- **Runtime image registry now auto-detects: BART GHCR proxy inside Samsung, else GHCR.**
  Inside the corporate network, direct GHCR pulls intermittently drop; the CLI now pulls the
  runtime image from BART's anonymous GHCR caching proxy
  (`ghcr-docker-remote.bart.sec.samsung.net/lwc0917/dali-preview-runtime`) when reachable, else
  `ghcr.io/lwc0917/dali-preview-runtime` — same repo path, so tags/digests match. `init`
  probes and persists the choice to `.dali/config.json` (`image` key). Image precedence:
  `--runtime-image` → `DALI_PREVIEW_IMAGE` env → `.dali/config.json` `image` → GHCR default.
  `--pull` now prints **which server** the ~290 MB download comes from. `--list-versions`
  always reads tags from ghcr.io, so the full tag list shows through the proxy too. `doctor`
  reports the same resolved image a render would use.

## [0.7.0] - 2026-07-01

### Added

- **`doctor` — machine-readable environment preflight.** Run `dali-ui-preview-cli doctor`
  *before* rendering to learn whether a runtime is ready and which one a bare render will use,
  instead of discovering it reactively via an exit-12/13 render failure. Prints one JSON line
  to stdout — `{schemaVersion, ready, recommended, configured, runtimes:{docker, local}}` —
  with **actionable `issues` strings** per runtime for an agent to relay to the human (the
  fixes need `sudo`). **No network**: Docker daemon check + local `docker images` tag lookup +
  filesystem readiness only, so it is cheap to run at the top of every session.
  - **Exit `0` when a runtime is ready, `13` when none is** (shared "no usable runtime" meaning
    with the render path), so a caller can gate work with `doctor && render`. The JSON report
    prints on stdout in **both** cases (the report is the successful output of a diagnosis).
  - `recommended` is availability-aware: the persisted `.dali/config.json` choice when usable,
    else Docker, else local, else `null`. `docker.imagePulled:false` (with `available:true`) is
    surfaced so an agent can warn about the one-time ~290 MB first-render pull.
  - The readiness logic is a **pure** `buildDoctorReport` (unit-tested with a truth-table like
    `chooseRuntime`); `runDoctor` is the thin async probe (`src/doctor.ts`).
  - Honors `--dali-prefix` / `--image-tag` / `--runtime-image` (the overrides that change what a
    render would probe); takes no input.
  - The **SKILL / `AGENTS.md` verification-loop** instructions now tell agents to run `doctor`
    first and to relay `issues` (not `sudo`-install silently) when `ready:false`.

## [0.6.0] - 2026-07-01

### Added

- **Image assets now render (both runtimes).** `ImageView::New("assets/foo.jpg")` /
  `SetResourceUrl("…")` local URLs — relative to the preview file, or absolute — are copied
  into the render workDir and rewritten so they resolve inside the container (`/work/<name>`)
  or on the host (local mode). Previously local-file images silently rendered blank because
  the CLI never staged them. An unresolvable or remote (`http(s)://`) URL now renders a bundled
  **gray broken-image placeholder** at the ImageView's size (layout preserved) instead of an
  empty frame. Ports the VS Code extension's `stageImageAssets` + broken-image placeholder;
  image-free previews keep a byte-identical harness. (`src/runtime/imageAssets.ts`.)

- **Local (native) runtime.** Render without Docker on a host that already has a built DALi
  install plus `g++`/`pkg-config`/`Xvfb`. Select per render with `--runtime local` (or the
  `--local` shorthand) and point at the install with `--dali-prefix <path>` (or set
  `DESKTOP_PREFIX` / `DALI_PREVIEW_PREFIX`). Ports the VS Code extension's proven native
  compile + Xvfb path (`src/runtime/{daliEnvironment,xvfb,localRunner}.ts`), so the
  `RenderResult` / scene-tree / exit-code contract is **identical** to Docker mode.
  - **Docker remains the default** — no behavior change when no runtime is selected.
  - **`.dali/config.json`** persists a project's runtime choice + DALi prefix; selection
    precedence is `--runtime`/`--local` → `DALI_PREVIEW_RUNTIME` env → config → `docker`.
  - **`init`** now detects *both* runtimes, picks one (Docker if available, else a ready
    local runtime; force with `init --docker` / `init --local`), persists the choice, and
    smoke-renders in that runtime.
  - **New exit code `13`** = selected local runtime unavailable (missing DALi prefix / `g++` /
    `Xvfb` / `pkg-config`); `12` still means Docker unavailable. When Docker is down but a
    native runtime looks ready, the error nudges you to retry with `--runtime local`.
  - **New scripts** `test:e2e:local` / `test:e2e:docker` render the bundled samples for real
    in each runtime and assert a non-blank PNG + a valid scene tree.
  - Caveat: local renders use the host DALi build + fonts (CJK needs `fonts-noto-cjk`), so
    output can differ from Docker; `--baseline` pixel checks are runtime-specific. The scene
    tree is structurally the same in both. `--list-versions`/`--pull` stay Docker-only.

## [0.5.0] - 2026-06-30

### Added

- **Cross-file previews.** A preview can now USE helpers / types / consts defined in
  *other* project files — `#include "widgets/card.h"` (relative path) and the CLI follows
  your project-local includes (transitively), **inlines** their definitions into the render,
  and renders. Ported from the VS Code extension's slice builder (`sliceBuilder` +
  `sliceSources`, harness `{{USER_GLOBALS}}`/`{{USER_INCLUDES}}` slots).
  - A referenced symbol the slice can't find gets a **weak placeholder** (grey View) so the
    render still appears, rather than hard-failing.
  - A compile error *inside* a collected helper surfaces as a real error pointing at **that
    file** (not a misleading "X not declared" in the preview).
  - Limits are documented in `templates/agent-verification-loop.md` / the skill so an agent
    knows what's supported (header-inlinable, project-local) vs not (system/out-of-project
    includes, separate-compilation linking). For full multi-file *app* preview, the VS Code
    extension's slicer is more complete.

## [0.4.0] - 2026-06-30

### Added

- **`dali-ui-preview-cli init`** — one-command project onboarding so a coding agent (Codex,
  Cursor, Claude Code, …) verifies the DALi UI it writes in a **render → look → fix** loop. It
  writes `AGENTS.md` (the verify-loop instruction, read by most agents) and
  `.claude/skills/dali-preview/SKILL.md` (Claude Code auto-activates it), then verifies Docker,
  pulls the runtime image, and smoke-renders a sample. Re-runnable (idempotent).
- **`templates/agent-verification-loop.md`** — the drop-in `AGENTS.md`/`CLAUDE.md` instruction
  `init` writes. Also installable globally in Claude Code as the **`dali-preview` skill** via the
  `dali-tools` plugin marketplace. See the README's "Use it from an AI coding agent" section.

Validated end-to-end: a fresh agent, given only the init-seeded `AGENTS.md`, discovered the CLI,
wrote DALi UI, fixed a compile error via the loop, and rendered correctly.

## [0.3.0] - 2026-06-23

### Changed

- **dali-ui non-fluent API migration.** dali-ui dropped the fluent chaining builder
  API: setters now return `void` and `View::Children(...)` was renamed to
  `View::AddChildren(...)`. The runtime image now tracks dali-ui **v2.5.26**
  (`dali_2.5.26`), shared with the VS Code extension, so preview code uses the
  non-fluent idiom — a named local, sequential setter statements, `AddChildren`
  for children, then `return root;`.
  - The bundled `samples/hello-dali.preview.dali.cpp` is rewritten in the
    non-fluent idiom (renders identically).
  - `transformVectorChildren` now rewrites the non-fluent
    `view.AddChildren(vector)` statement form into an `.Add()` loop; the legacy
    `return EXPR.Children(vector);` fluent form is still handled so pre-migration
    snippets keep working.

## [0.2.0] - 2026-06-19

### Changed

- **Default render resolution is now TV FHD (1920×1080)** — DALi UI apps target the
  TV, so a bare render reflects the real device canvas. Override per render with
  `--resolution WxH` (e.g. `--resolution 1024x600`) exactly as before.

This release also tags the accumulated scene-tree / mapping / report / verify work
below, previously unreleased since 0.1.0.

### Canonical scene tree (M1)

- Every node carries `id` (structural path like `0/1/0`), `mark` (1-based ordinal),
  `type`, `role` (type→role map), frame-accurate `bounds{x,y,w,h}`
  (`CalculateCurrentScreenExtents`), `name`, `semanticsSource` (`bridge`|`reconstructed`),
  `sourceLine`, `properties`, optional `flexProps`, and `children`.
- Deterministic output: two renders of the same input are byte-identical.
- Input modes: a file path, a `-`/piped **STDIN** code block, or inline `--code "<text>"`.
- `--image` is now optional — a bare invocation prints the tree JSON to stdout.
- Empty input is rejected immediately (clear error, no container spin-up).

### Image ↔ tree mapping (M2)

- `--overlay <png>` writes a Set-of-Mark annotated PNG (numbered magenta boxes per node).
- `--at X,Y` prints the topmost (smallest-area) node at a pixel; `--node <id>` prints a
  node's region. Both emit a flat `{id, mark, type, role, bounds}` JSON.
- Marks and ids are co-assigned in one tree walk, so the overlay number and the JSON `mark`
  can never drift.

### Dual output: human + report + token caps + watch (M3)

- `--format tree` prints a box-drawing hierarchy (`Type "name" #mark [id] (WxH @ x,y)`)
  instead of JSON.
- `--report <file.html|.md>` writes a self-contained report (embedded PNG + box-tree +
  node table); the JSON tree is still printed to stdout.
- `--max-depth N` / `--max-nodes N` bound the stdout JSON for token-limited callers
  (a `truncated` marker shows where pruning happened).
- `--watch` re-renders on file change (FILE input only).

### Verify loop: image + tree diff (M4)

- `--baseline <png>` image-diffs the render (pixel ratio + pass/fail); `--baseline-tree <json>`
  id-keyed tree-diffs it (added / removed / changed nodes).
- stdout becomes a single `{match, image?, tree?}` verdict; exit 0 on match, 20 on divergence
  (distinct from a tool error).
- `--threshold <ratio>` sets the image-diff fail ratio; `--update-baseline` writes the current
  render as the new baseline(s).

### Config + structured errors + exit codes (M5)

- `--resolution WxH` (default 1024x600), `--theme dark|light` (default dark), `--dpr N`
  (default 1) control the render; the effective config is echoed as `root.meta`.
- Compile/render failures print a structured `{phase, message, sourceLine}` JSON to stderr;
  stdout stays empty.
- Distinct exit codes: 0 ok, 1 usage/empty input, 10 compile error, 11 render error,
  12 docker unavailable, 20 verify diff mismatch.

### Packaging + release readiness (M6)

- Complete `--help`/`--version` reference (all flags + exit-code table + examples).
- `README.md` with quickstart, worked examples per feature, the JSON node schema, and an
  AI-agent usage note.
- npm-distributable (`files`/`engines`/`license`/`keywords`/`repository`/`prepublishOnly`)
  and a CI workflow (build + test + CLI smoke; the Docker render path runs on a self-hosted
  runner only).

### Rename + runtime version management

- Renamed the package and its single command to `dali-ui-preview-cli` (the `bin`,
  `repository`, and every `--help`/diagnostic string now use it).
- Runtime image versions track DALi releases as `dali_<DALiVersion>` tags (e.g. `dali_2.5.18`),
  plus the rolling `latest`.
- `--list-versions` prints the available runtime versions (remote registry ∪ local docker,
  each marked `local`/`current`) as JSON; tolerates docker being down (lists remote with
  `local: false`).
- `--pull [<tag>]` downloads a runtime image tag (default `latest`), streaming docker's
  progress to stderr and printing `{"pulled":"<ref>","ok":true}` to stdout.
- `--image-tag <tag>` selects the runtime tag for a render (default `latest`); `--runtime-image
  <name>` overrides the runtime image name (advanced). Both also apply to `--list-versions`
  and `--pull`.

## 0.1.0 — M0 (build infra + first end-to-end render)

- `dali-ui-preview-cli <input> --image <out.png>` — resolves DALi preview C++ from a
  `*.preview.dali.cpp` file (or `@dali-preview-begin/end` markers), renders it
  headlessly in the runtime Docker image, writes the PNG, and prints a minimal
  scene-tree JSON (per-node type + nesting) to stdout. `--version` / `--help`.
- Vendored the DALi harness template + C++/flex/error parsers for a self-contained
  release (ADR-007).
- A11y spike (ADR-008): `Accessibility::DumpTree` works headless **without** D-Bus,
  emitting a per-node semantic tree (role / states / text / type / bounds) — M1
  will consume it alongside the property walk.
