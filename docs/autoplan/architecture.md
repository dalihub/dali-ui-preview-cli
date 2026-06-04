# Architecture — dali-ui-preview CLI

> Scope: the whole project, M0..M6 (plan.md). Design covers only what those 31 features need.
> Every library choice names a research.md candidate. Decisions are recorded as ADRs (append-only) under `adr/`.
> Grounding: the four autoplan docs and the sibling paperclip infra (`../server/preview_harness.cpp.template`, `../server/preview_server.cpp`, `../src/cppParser.ts`, `../src/flexMetadata.ts`, `../src/errorParser.ts`, `../src/dockerRuntime.ts`, `../docker/Dockerfile.runtime`, `../package.json`) were read directly.

## Stack (final choices)

| Layer | Choice | Why over alternatives (cite research.md candidate) |
|---|---|---|
| CLI language / runtime | **Node.js v24.14.1 + TypeScript ^5.9.3** (`tsc` → `out/`, `bin` entry) | Reuses the three existing TS modules (`cppParser`/`flexMetadata`/`errorParser`) and the already-present `pixelmatch`/`pngjs` deps with zero rewrite; `npx` is the most agent-friendly install. Over **Go/Rust** (single binary — but orphans the TS parsers; CLI isn't CPU-bound and ships a 1GB image anyway) and **Python** ("배포 무거움"). → ADR-001 |
| How the CLI drives Docker | **`docker run --rm` per invocation** (one-shot), bind-mount `workDir:/work`, env `PREVIEW_WIDTH/HEIGHT` + `GALLIUM_DRIVER=llvmpipe` + `EINA_LOG_*` silencers, entrypoint `dali-preview-entrypoint /work/source.cpp`; persistent `ccache`/shader-cache named volumes; read PNG + metadata JSON back from `workDir`; success = exit 0 and `OK:` on stdout | Mirrors the sibling `dockerRuntime.buildAndCapture` model exactly. Stateless per call → simplest determinism + self-containment. Over **`docker exec` into a long-running server** (a latency optimization the CLI doesn't need; adds server lifecycle). The CLI verifies `docker info` (sibling `isAvailable` pattern) before rendering. → ADR-002, ADR-006 |
| Render backend (reuse) | **One-shot `preview_harness.cpp.template`** (vendored + extended), compiling the user's **actual** C++ | Only path that compiles real user code → faithful render, honest g++ errors (M5), real `__tag` provenance. Over **long-running `preview_server` RENDER_JSON** ("빠름" — but renders a *TS-parser reconstruction* via `SBBuildNode`'s hardcoded type switch, not the user's code) and **native DALi** (breaks fixed-image determinism). → ADR-002 |
| Tree-extraction approach | **Property-reconstructed walk as guaranteed default** — `GetTypeName()` + `GetPropertyIndices()`/`GetCurrentProperty()` + `DevelActor::CalculateCurrentScreenExtents()` for bounds + control-type→default-role table for semantics; **optional `Accessible::DumpTree` enrichment** behind a runtime capability probe | research.md candidate "`CollectActorMetadata` 확장(일반 열거 + CalculateCurrentScreenExtents)" as the floor; "`Accessible::DumpTree`(헤드리스 동작 시)" as additive. Robust to the M0 a11y unknown either way (D-Bus may be absent headless — sibling already suppresses `Accessibility`/`dbus` errors). → ADR-003 |
| Image-diff | **`pixelmatch` ^7.1.0 + `pngjs` ^7.0.0** | research.md "pixelmatch + pngjs(이미 의존)" — already in sibling `package.json`; matches the golden/`failureThreshold` pattern. Over **odiff** (external native binary; cuts against self-containment). → ADR-005 |
| Tree-diff | **Custom JSON diff keyed on stable `id`** (map `id→node`, report added/removed/changed-fields) | research.md "커스텀 JSON diff". Diffs on *identity* (ADR-004 path), which **deep-diff** cannot — deep-diff's path-based deltas turn a reordered sibling into noise instead of a clean by-id change (F4.2). → ADR-005 |
| Output formatting | **stdout JSON (primary)** + **box-drawing tree (`┖╴`, human)** + **HTML/MD report** + **Set-of-Mark PNG overlay** | research.md "기계용 JSON + 사람용 박스드로잉 트리 + HTML/MD 리포트"; "stdout JSON 1차 계약, 이미지는 플래그로 on-demand". All formats render from one in-memory tree (swift-snapshot "strategies" pattern → cannot drift). |
| Stable-ID strategy | **Structural path id** (`0/2/1` = child-index chain), source-anchored via carried `sourceLine`, assigned in the one DFS that also stamps overlay marks | research.md Set-of-Mark + Flutter source-provenance. Deterministic + addressless (F1.3); stable under content/position edits so tree-diff reports real changes. Over DALi `GetId()` (process-local counter = "memory address" class) and property-hash (churns on the very edits the verify loop makes). → ADR-004 |
| Distribution | **npm package via `npx dali-ui-preview`** + GitHub release (source tarball + changelog); runtime image pulled from GHCR by tag on first render | research.md "npm 패키지(npx)". Lowest install friction for humans+agents; CLI stays thin (the 1GB image is delivered out-of-band by `docker pull`, decoupled by tag). Over **prebuilt binary matrix** and **Docker-wrapping the CLI** (DinD/socket fragility). → ADR-006 |
| Testing tiers | **tier-3 unit** (parser/formatter/schema/diff — mocha+c8, lifted from sibling) always; **tier-2 exec-assert** on stdout JSON; **tier-1 golden PNG** (pixelmatch) once the M0 container path is green | research.md "단위 / golden PNG / CLI 스모크"; see project-profile.md `exec_test_tiers_available` (refined by this architecture). |

## Module boundaries

Two layers separated by a **process boundary** (`docker run`). The TS/CLI layer never renders; the C++ layer never formats. They communicate through exactly three artifacts in the bind-mounted `workDir`: the templated **`source.cpp`** (TS→C++), the captured **PNG**, and the **tree metadata JSON** (C++→TS).

```
┌───────────────────────────── TS / CLI orchestration layer (Node, out/) ─────────────────────────────┐
│                                                                                                       │
│  cli.ts            argument/flag parsing, subcommand dispatch (render | tree | overlay | diff |       │
│                    watch | baseline | --help), exit-code mapping            [M5/F5.4, M6/F6.1]         │
│  inputResolver.ts  resolve input: file path | inline snippet | stdin; detect preview-file vs marker   │
│                    region; hand raw C++ + startLine to the harness templater    [M0/F0.3]             │
│  cppParser.ts      (VENDORED) C++ chain → SceneNode{type,args,props,children,sourceLine}. Used for     │
│                    source-side enrichment (flex props, layout policies) + sourceLine map  [M1/F1.5]    │
│  flexMetadata.ts   (VENDORED) merge parser SceneNode props into the runtime tree   [M1/F1.1]          │
│  harnessTemplater  fill preview_harness.cpp.template: {{USER_CODE}}, {{PREVIEW_W/H}}, {{FONT_SETUP}},  │
│                    {{BACKGROUND}}, output/metadata paths; bake theme/dpr/resolution  [M2/M5]          │
│  dockerRunner.ts   (ADAPTED from dockerRuntime.ts) docker preflight (`docker info`), `docker run --rm` │
│                    one-shot, volume mounts, env, timeout, read-back PNG+JSON, exit/`OK:` parse  [M0]   │
│  treeModel.ts      parse metadata JSON → canonical in-memory Node tree; apply --max-depth/--max-nodes  │
│                    truncation; the SINGLE tree every formatter consumes   [M1/F1.1, M3/F3.3]           │
│  idMap.ts          (ids/marks already assigned in C++; here: build mark↔id↔bounds lookup tables for    │
│                    coord→node / node→region)   [M2/F2.3, F2.4]                                         │
│  formatters/                                                                                           │
│    jsonFormatter      token-bounded JSON (primary stdout contract) + config-echo metadata block       │
│    treeFormatter      box-drawing `Name <Type#id>` hierarchy (human)   [M3/F3.1]                       │
│    reportFormatter    self-contained HTML/MD bundling tree + image ref   [M3/F3.2]                     │
│    overlayRenderer    draw numbered marks/boxes onto the PNG via pngjs (Set-of-Mark)   [M2/F2.1]       │
│  diff/                                                                                                 │
│    imageDiff.ts       pixelmatch+pngjs → score + diff artifact + pass/fail   [M4/F4.1]                 │
│    treeDiff.ts        custom id-keyed diff → added/removed/changed   [M4/F4.2]                         │
│    verdict.ts         roll image+tree into one pass/fail + exit code   [M4/F4.3]                       │
│  errorParser.ts    (VENDORED, vscode-stripped) g++ stderr → {phase,message,sourceLine}   [M5/F5.3]    │
│  watch.ts          fs.watch the input → re-invoke the one-shot render pipeline   [M3/F3.4]            │
│                                                                                                       │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                          source.cpp ↓           │  ↑ preview.png + tree.json      (workDir bind-mount)
┌───────────────────────────────────────────────┴───────────────────────────────────────────────────┐
│                       C++ render / introspection layer  (inside the fixed runtime image)             │
│                                                                                                       │
│  preview_harness.cpp (VENDORED + EXTENDED from .template):                                            │
│    • compile + run the user's REAL C++ (CreatePreviewUI), Xvfb/offscreen, fonts fixed, anim disabled  │
│    • Capture → PNG     [M0/F0.3]                                                                       │
│    • TreeExporter (one interface, two sources — ADR-003):                                             │
│        - PropertyWalk (DEFAULT, no D-Bus): GetTypeName + GetPropertyIndices/GetCurrentProperty,        │
│          bounds via DevelActor::CalculateCurrentScreenExtents, semantics via controlType→role table   │
│        - DumpTreeEnrich (OPTIONAL, behind capability probe): Accessible::DumpTree augments role/name/  │
│          value/automationId IFF the bridge works headless                                              │
│      → emits canonical tree JSON: per node {id (structural path), mark, type, role, name, bounds,      │
│        sourceLine, key properties, children}, children in sorted order, addresses stripped            │
│        [M1/F1.1-F1.5, M2/F2.2]                                                                         │
│    • writes semanticsSource:"bridge"|"reconstructed" into metadata (auditability)                     │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**The TS↔C++ boundary (the contract):** TS owns *everything except pixels and the live DALi actor tree*. The harness owns *rendering and introspection only* and is "dumb" about presentation — it emits one canonical JSON tree and one PNG; it does not format trees, does not diff, does not know about `--max-nodes`. Crucially, **stable ids and overlay marks are assigned inside the harness's single DFS** (ADR-004) so the numbers on the image and the ids in the tree are literally the same emission (Inv-1). TS *consumes* that tree to produce every human/AI surface. This keeps determinism enforceable at one point (the harness emitter) and keeps the formatters pure functions of the tree.

## Data flow

One invocation (`dali-ui-preview <input> [flags]`):

1. **Input → parse (TS).** `inputResolver` reads file/snippet/stdin, picks preview-file vs marker region, yields raw preview C++ + absolute `startLine`. `cppParser` parses it to a `SceneNode` (for flex/layout-policy source enrichment + the sourceLine map); failure here is non-fatal for rendering (the harness compiles the raw C++ regardless) but feeds M5 structured errors if compilation later fails.
2. **Template (TS).** `harnessTemplater` fills the vendored harness with `{{USER_CODE}}` + resolution/dpr/theme/background/font-setup baked from flags (M5/F5.1), and the in-container output/metadata paths. Writes `workDir/source.cpp`.
3. **Render-in-container (boundary).** `dockerRunner` runs `docker info` preflight, then `docker run --rm -v workDir:/work -e PREVIEW_W/H ... <image:tag> /work/source.cpp` with `ccache`/shader volumes. The harness compiles+runs the user's code under Xvfb, `Capture`s the PNG, and the `TreeExporter` walks the live actor tree.
4. **Capture + tree-dump (C++).** Inside that one process: PNG written to `/work/...`; the **single DFS** assigns each node its structural-path `id` + ordinal `mark`, reads type/bounds(`CalculateCurrentScreenExtents`)/semantics/properties/sourceLine, optionally augments via the DumpTree probe, and writes the canonical tree JSON (children sorted, addresses stripped) plus `semanticsSource`. Process exits; stdout carries `OK:` / a g++ error / a capture error.
5. **Format → output (TS).** `dockerRunner` reads back PNG + JSON. `treeModel` builds the one canonical tree and applies `--max-depth`/`--max-nodes`. Then, on demand by flags: `jsonFormatter` (default stdout, token-bounded, with config-echo metadata), `treeFormatter` (box-drawing), `reportFormatter` (HTML/MD), `overlayRenderer` (marks on PNG). For verify mode, `imageDiff` + `treeDiff` → `verdict`. `errorParser` maps any compile failure to `{phase,message,sourceLine}`. `cli` maps the outcome to a documented exit code.

**State ownership map:**
- **Flags / config** (resolution, theme, dpr, max-depth/nodes, baseline path, image tag, thresholds) — owned by `cli` (TS), echoed into output metadata (M5/F5.2). Single source of truth for "what settings produced this output."
- **Raw preview C++ + sourceLine map** — owned by `inputResolver`/`cppParser` (TS).
- **The rendered PNG + the live actor tree** — owned transiently by the C++ harness inside the container; never leaves except as the two read-back artifacts.
- **Canonical tree (with ids/marks/bounds)** — *authored* by the harness, *owned* (in memory, for all formatting/diffing) by `treeModel` (TS). Ids/marks are assigned exactly once, in C++.
- **Diff baselines** (golden PNG / target tree) — files on disk supplied by the caller; `--update-baseline` writes the current render as the new target (M4/F4.4).
- **Determinism state** (fixed fonts, disabled animations, sorted children, stripped addresses) — enforced **inside the harness/image**, not on the host.

**Where determinism is enforced:** at the C++ emitter, single point. (a) Render happens *only* inside the fixed image (fonts bundled, llvmpipe software GL, animations disabled) → no host font/AA drift (project-profile.md `infra_gaps`). (b) The tree JSON is emitted by one DFS with children in a fixed sorted order, structural-path ids (not pointers), and addresses stripped → byte-identical across runs (F1.4). The TS formatters are pure functions of that tree, so they add no nondeterminism.

## Key invariants

- **Inv-1 (one source for ids ↔ marks):** A node's tree `id`/`mark` and the number drawn on the overlay are produced by the *same* harness DFS emission — TS never re-derives them. *If violated, breaks M2/F2.2 (Set-of-Mark id parity / set-equality) and M2/F2.4 (node→image-region).* Auditable: overlay marks are read from the same metadata JSON the tree comes from; there is no second id generator.
- **Inv-2 (tree-source independent of the a11y bridge):** The canonical schema is fully produced by the property-reconstructed walk with **no D-Bus dependency**; `DumpTree` only *augments* and may be absent. *If violated, breaks M1 entirely if the M0 spike answers "bridge dead headless."* Auditable: `semanticsSource:"reconstructed"` must still yield a complete, schema-valid tree; tests run with the bridge assumed off.
- **Inv-3 (byte-identical tree across runs):** Two consecutive renders of the same input + same flags produce identical tree JSON (sorted children, structural-path ids, addresses stripped, no timestamps/addresses). *If violated, breaks M1/F1.4 and the entire verify loop M4 (tree-diff would report phantom changes).* Auditable: `render twice | diff` is empty (tier-2 test).
- **Inv-4 (render happens in the fixed image, never the host):** All compilation + rendering occur inside `ghcr.io/lwc0917/dali-preview-runtime:<tag>`; the host only orchestrates and formats. *If violated, breaks determinism (host font/AA drift) → golden-image flakiness (research.md pitfall) → M4 false diffs.* Auditable: the only render path is `dockerRunner` → `docker run`; no native DALi link on the host.
- **Inv-5 (faithful render = user's real C++ compiled):** The PNG and tree come from compiling the user's actual source via the harness, not from a reconstruction. *If violated, breaks M1/M2 fidelity and M5/F5.3 honest compile errors (a reconstruction can't surface real g++ diagnostics).* Auditable: the in-container `source.cpp` contains the user's verbatim preview code in `{{USER_CODE}}`; no `SBBuildNode`-style rebuild is used.
- **Inv-6 (JSON stdout is the primary contract; image is on-demand):** A bare invocation emits the (token-bounded) JSON tree to stdout; PNG/overlay/report are produced only when their flags are passed. *If violated, breaks the agent contract (project-goal.md: "stdout JSON 1차 계약") and M3/F3.3 token budgeting.* Auditable: no flag → no file writes beyond the working PNG the harness needs; stdout is parseable JSON.
- **Inv-7 (config echoed = config used):** The resolution/theme/dpr in the output metadata are the exact effective values passed to the render. *If violated, breaks M5/F5.2 (inverting the axe "테마를 소스에 가둠" weakness).* Auditable: metadata block equals the flags the harness was templated with.
- **Inv-8 (id identity survives content/position edits):** A node's `id` depends only on its structural path, not its properties, so editing text or nudging position keeps the same id. *If violated, breaks M4/F4.2 (tree-diff would show remove+add churn instead of a real "changed").* Auditable: edit a label's text → tree-diff reports `changed`, not `removed`+`added`.

## ADR index

- ADR-001: CLI language / runtime (Node + TypeScript) — adr/ADR-001-cli-language-runtime.md
- ADR-002: Render-backend reuse (one-shot harness vs long-running server) — adr/ADR-002-render-backend-reuse.md
- ADR-003: Tree-source robustness to the a11y spike (property-reconstructed default + optional DumpTree) — adr/ADR-003-tree-source-a11y-robustness.md
- ADR-004: Stable-ID strategy (structural-path id, source-anchored) — adr/ADR-004-stable-id-strategy.md
- ADR-005: Image-diff + tree-diff libraries (pixelmatch/pngjs + custom id-keyed diff) — adr/ADR-005-diff-libraries.md
- ADR-006: Distribution channel (npm/npx + GHCR image by tag) — adr/ADR-006-distribution-channel.md
- ADR-007: Vendoring vs referencing paperclip infra (vendor source+harness, reference image) — adr/ADR-007-vendoring-paperclip-infra.md
- ADR-008: M0 a11y-spike empirical result (DumpTree headless yes/no) — adr/ADR-008-a11y-spike-result.md *(to be authored during M0/F0.5; ADR-003 fixes the structure that makes either answer safe)*

## Self-Review

- **Placeholder scan:** No `TBD`/`FIXME`/`???` left. One intentional forward-reference: **ADR-008** (the M0 spike's empirical yes/no on headless `DumpTree`) is listed in the index but authored during M0/F0.5 — this is by design, not a placeholder: ADR-003 commits the *architecture* (property-reconstructed default, bridge as optional enrichment, Inv-2) now, so no milestone is blocked on the answer; ADR-008 will only record the observed result. Flagged in OPEN_QUESTIONS so it is not lost.
- **Internal consistency:** The module table, data flow, invariants, and ADRs agree. Stable ids are defined once (ADR-004), assigned in the C++ DFS, and consumed by Set-of-Mark (Inv-1), tree-diff (Inv-8), and node↔image lookup — no redefinition. The render backend (one-shot harness, ADR-002) is the same path referenced by Inv-4/Inv-5 and the data flow. Determinism is stated where enforced (C++ emitter) and underpins Inv-3 and M4. The TS↔C++ boundary (TS = parse/format/diff, C++ = render/introspect, three-artifact contract) is consistent across the module diagram, data flow, and ownership map. Vendoring (ADR-007) matches the "(VENDORED)" tags in the module diagram and the M6 self-contained-clone requirement.
- **Scope check:** All five goal differentiators map to design: linked image+tree via shared ids (Inv-1, overlayRenderer, idMap); verify loop (imageDiff/treeDiff/verdict, ADR-005); dual human/AI output (treeFormatter/reportFormatter + token-bounded jsonFormatter); config-echo metadata (Inv-7, M5); structured errors+exit codes (errorParser, cli exit mapping, M5). Every milestone M0–M6 has owning modules. Nothing designed beyond M6 (no plugin system, no server, no GUI — all out of scope per goal). Each library names a research.md candidate (pixelmatch/pngjs, custom JSON diff, npx, CalculateCurrentScreenExtents/DumpTree, Node/TS). The long-running server and odiff/deep-diff are explicitly rejected, not silently dropped.
- **Ambiguity → resolve or escalate:** The only genuine open is the M0 a11y outcome — resolved *architecturally* by ADR-003/Inv-2 (the project never depends on the bridge), and escalated below as the single OPEN_QUESTION for the M0 spike to record empirically in ADR-008. No other unresolved ambiguity: input modes, render path, id derivation, diff libs, distribution, and vendoring are all concretely chosen.

OPEN_QUESTIONS:
- M0/F0.5 → ADR-008: Does `Accessibility::Accessible::DumpTree` produce a usable semantic tree in the headless runtime container WITHOUT a live D-Bus session? The architecture is robust either way (Inv-2: property-reconstructed walk is the guaranteed default; DumpTree is additive enrichment only). The empirical yes/no, and whether `role`/`automationId` enrichment is available, is the M0 spike deliverable recorded in ADR-008 — it does not block M1.
