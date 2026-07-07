# Changelog

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
