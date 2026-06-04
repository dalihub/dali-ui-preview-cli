# Plan — `dali-ui-preview` CLI: DALi UI code → deterministic PNG + structured UI tree, optimized for an AI write→preview→verify loop (and humans)

> Sources read directly: `docs/autoplan/project-goal.md`, `docs/autoplan/research.md`, `docs/autoplan/project-profile.md`.
> Grounding check performed: this worktree currently tracks only `docs/`. The reused paperclip infra (`../server/preview_harness.cpp.template`, `../server/preview_server.cpp`, `../src/cppParser.ts`, `../src/flexMetadata.ts`) and the Docker runtime image (`ghcr.io/lwc0917/dali-preview-runtime`) exist in the sibling tree and are confirmed present. The harness already provides `CollectActorMetadata` (general actor-tree walk), `__tag` (source-line tagging), and `Capture` (PNG); neither the harness nor the server currently uses `Accessibility::Accessible::DumpTree` or `DevelActor::CalculateCurrentScreenExtents`, confirming those are net-new and the a11y bridge behavior is genuinely UNVERIFIED. No `samples/*.preview.dali.cpp` is tracked here yet, so M0 must also land the canonical fixture (a copy/reference of the paperclip `hello-dali` sample) — the "existing sample file" the loop runs against.

## Milestone overview

| M | Title | Demonstration | Depends on |
|---|---|---|---|
| M0 | Build infra + a11y spike | `npm run build` succeeds, then `dali-ui-preview <sample> --image out.png` runs end-to-end inside the runtime container and emits *a* PNG + *a* minimal tree (JSON on stdout); the spike question "does `DumpTree` work headless without a D-Bus session?" is answered in an ADR with a yes/no + chosen tree-source fallback. | — |
| M1 | Core render + canonical tree schema | On the sample, the CLI prints a stable, deterministic JSON tree (typed nodes, accurate screen-extent bounds, stable IDs) that is byte-identical across two consecutive runs. | M0 |
| M2 | Image ↔ tree linking (Set-of-Mark) | Same render yields a PNG with numbered overlay marks whose IDs exactly match the tree's stable IDs; an `--overlay`/coords map lets a caller point at a tree node and see it boxed in the image. | M1 |
| M3 | Dual output: human + AI surfaces | One render produces, on demand, a box-drawing tree + an HTML/MD report (human) and a token-bounded JSON honoring `--max-depth`/`--max-nodes` (AI); a `watch` mode re-renders on file change. | M1 |
| M4 | Verify loop: image-diff + tree-diff | `dali-ui-preview <code> --baseline ref.png` reports a pixel-diff score + a structural tree-diff vs a target, with a pass/fail threshold an agent can branch on. | M2 |
| M5 | Config surface + structured errors + exit codes | `--resolution/--theme/--dpr` change the render and are echoed in output metadata; a compile/runtime failure prints a structured error `{phase,message,sourceLine}` and exits with a distinct, documented code. | M1 |
| M6 | Packaging + GitHub release readiness | A fresh clone runs `--help`, the README quickstart, and the bundled examples; CI runs a smoke job (`--help`, sample render, exit-code checks) green on push. | M2, M3, M4, M5 |

Dependency graph (cycle-free): M0 → M1; M1 → {M2, M3, M5}; M2 → M4; {M2, M3, M4, M5} → M6. (M2 depends on M1 for stable IDs; M4 depends on M2 because tree-diff and Set-of-Mark share the stable-ID contract.)

7 milestones — slightly above the lower end of the rough guide but within it. Rationale: the five goal differentiators (linked image+tree, verify loop, dual human/AI output, config-echo metadata, structured errors+exit codes) are distinct user-visible contracts that each deserve their own shippable demonstration and their own dependency edges, so collapsing them would hide real ordering (e.g. verify-loop's tree-diff genuinely needs the stable-ID schema from M2).

## Milestone details

### M0 — Build infra + a11y spike
**Demonstration**: From a clean checkout, `npm run build` (or equivalent) compiles the CLI with zero errors; `dali-ui-preview <bundled-sample> --image out/preview.png` runs the full path (parse input → build/render in the runtime container under headless Xvfb/offscreen → capture) and produces *a* PNG plus *a* minimal node tree printed as JSON to stdout. Separately, the spike is resolved: an ADR records whether `Accessibility::Accessible::DumpTree` yields a semantic tree in the headless container **without** a D-Bus session (documented yes/no), and which tree-source path the project will take.
**Out of scope**: rich/canonical tree schema (M1); stable IDs, overlay, diffing, config flags, structured-error contract, packaging (later milestones); choosing the final language/runtime, render backend, or diff library (architect's job — features use abstract names only).
**Features**:
- F0.1: Project skeleton + reproducible build — `<a clean clone> → install → build` succeeds with zero errors and produces a runnable CLI entrypoint; acceptance: a contributor following the build step gets a binary/launcher that prints something on `--version`.
- F0.2: Canonical sample fixture lands in-repo — a `hello-dali` preview sample (copied/derived from the paperclip sample) is committed under the repo so every later milestone has a fixed input; acceptance: the file exists and is the documented "run this" example.
- F0.3: Container render + capture path wired end-to-end — given the sample, the CLI orchestrates a headless render in the runtime image and writes a PNG to a user-given path; acceptance: a user runs one command and gets a non-empty PNG of the sample UI.
- F0.4: Minimal tree emission — the same run prints a minimal JSON tree (at least per-node type + nesting) to stdout; acceptance: a user sees structured text (not pixels) describing the UI hierarchy.
- F0.5: ⚠️ A11y-bridge spike + decision record — verify whether `DumpTree` produces a semantic tree headless without D-Bus, and pick the tree source accordingly (free semantic tree vs property-reconstructed via general enumeration); acceptance: an ADR in `docs/autoplan/adr/` states the yes/no answer, the chosen fallback, and the resulting tree-schema direction for M1.

### M1 — Core render + canonical tree schema
**Demonstration**: On the bundled sample, `dali-ui-preview <sample>` prints a complete, deterministic JSON tree where every node carries a concrete type label (never bare/name-only), accurate on-screen bounds matching the rendered frame, and a stable ID — and running the command twice yields byte-identical output.
**Out of scope**: image overlay/linking visuals (M2); human report & token caps (M3); diffing (M4); config flags & error contract (M5).
**Features**:
- F1.1: Canonical node schema — each node exposes `{ id, type, role/semantics (per M0 decision), name, bounds{x,y,w,h}, key properties, children }`; acceptance: a caller can read a node's type and box without guessing, and missing-type cases fall back to a typed default (e.g. `Actor`), never name-only.
- F1.2: Frame-accurate bounds — node bounds come from the render-frame screen-extents path (not hand-computed parent-origin math); acceptance: a node's reported box matches where it visibly sits in the M0 PNG within tolerance.
- F1.3: Stable IDs across runs — IDs are derived deterministically (structural/source-anchored, not memory addresses) so the same input always yields the same IDs; acceptance: two runs on the sample produce identical IDs for the same nodes.
- F1.4: Determinism guarantees — fonts fixed, animations disabled, addresses stripped, collections/children ordered; acceptance: two consecutive tree dumps of the sample diff to zero.
- F1.5: Source-line provenance on nodes — each node, where derivable, carries the originating source line (reusing the harness `__tag` mechanism); acceptance: a caller can map a tree node back to the line of input code that produced it.

### M2 — Image ↔ tree linking (Set-of-Mark)
**Demonstration**: A single render emits both a PNG annotated with numbered marks and a tree, where each mark's number equals the corresponding node's stable ID; with `--overlay` a caller picks an ID from the tree and sees exactly that node boxed/labeled in the image, and a coordinate→node lookup resolves a clicked point back to its node.
**Out of scope**: report formatting & token caps (M3); diffing thresholds (M4); config-echo & errors (M5).
**Features**:
- F2.1: Set-of-Mark overlay — an `--overlay` (or equivalent) flag renders numbered marks on the PNG keyed to node stable IDs; acceptance: a user sees ID-labeled boxes on the image that line up with the tree.
- F2.2: ID parity guarantee — overlay mark IDs and tree node IDs come from one shared source so they cannot drift; acceptance: for the sample, every visible mark ID appears in the tree and vice versa (set equality).
- F2.3: Coordinate → node hit lookup — given an (x,y), the CLI returns the matching node ID (click-to-code direction); acceptance: a user passes a pixel coordinate over a button and gets that button's node back.
- F2.4: Node → image region resolution — given a node ID, the CLI reports its image box (and can isolate/crop it); acceptance: a caller selects a node ID and gets pixel coordinates they can visually confirm against the overlay.

### M3 — Dual output: human + AI surfaces
**Demonstration**: From one render, the CLI can produce (a) a human box-drawing tree (`┖╴`-style) and an HTML/MD report, and (b) a machine JSON tree bounded by `--max-depth` and `--max-nodes` so it fits a small token budget; a `watch` mode re-runs the render automatically when the input file changes.
**Out of scope**: image linking visuals (M2, consumed here but not built here); diffing (M4); config flags & error contract (M5); packaging (M6).
**Features**:
- F3.1: Box-drawing tree renderer — `--format tree` (or default human mode) prints an indented box-drawing hierarchy with `Name <Type#id>` per node; acceptance: a human reads the structure at a glance in the terminal.
- F3.2: HTML/MD report — `--report` emits a single self-contained human report bundling the tree (and image reference); acceptance: a user opens one file and sees the preview + structure together.
- F3.3: Token-bounded JSON with caps — `--max-depth` and `--max-nodes` truncate the JSON tree predictably (with a truncation marker), keeping output within a few KB; acceptance: an agent sets caps and the JSON stays under budget while signaling that it was trimmed.
- F3.4: Watch mode — `watch` re-renders + re-emits on input-file change; acceptance: a user edits the sample and sees the preview/tree refresh without re-invoking the command.

### M4 — Verify loop: image-diff + tree-diff
**Demonstration**: `dali-ui-preview <code> --baseline ref.png` renders the input, computes a pixel-diff against the target image, and a structural tree-diff against a target tree, then reports both a quantitative score and a pass/fail verdict against a threshold an agent can branch on (distinct exit/status for "matched" vs "diverged").
**Out of scope**: generating the baselines themselves beyond a simple `--update-baseline`; report styling (M3); config-echo internals (M5).
**Features**:
- F4.1: Image-diff vs baseline — `--baseline <png>` produces a diff score + a visual diff artifact and a threshold-based pass/fail; acceptance: an agent gets a number plus yes/no for "did my change move pixels toward the target?".
- F4.2: Tree-diff vs target — structural diff of the current tree against a target tree, keyed on stable IDs, reporting added/removed/changed nodes; acceptance: an agent sees which nodes changed (not just that something changed).
- F4.3: Combined verdict + agent-branchable result — image and tree results roll up into one pass/fail with a documented threshold and a distinct result signal; acceptance: an agent can decide "close enough, stop the loop" from a single field/exit code.
- F4.4: Baseline capture/update — `--update-baseline` (or equivalent) writes the current render as the new target; acceptance: a user accepts a render as the golden in one command.

### M5 — Config surface + structured errors + exit codes
**Demonstration**: `dali-ui-preview <code> --resolution WxH --theme <t> --dpr <n>` changes the produced render, and the exact resolution/theme/dpr used are echoed back in the output metadata; when input fails to compile or render, the CLI prints a structured error `{phase, message, sourceLine}` and exits with a distinct, documented exit code per failure phase.
**Out of scope**: image linking (M2); diffing (M4); packaging/CI (M6). Config flags introduced here are consumed by all output modes but their contract is owned here.
**Features**:
- F5.1: Render config flags — `--resolution`, `--theme`, `--dpr` (at minimum) actually alter the render; acceptance: changing `--resolution` yields a differently sized PNG.
- F5.2: Config echo in metadata — every output (JSON and report) carries a metadata block echoing the effective resolution/theme/dpr (inverting the axe weakness of hiding theme in source); acceptance: a caller reads back exactly what settings produced this output.
- F5.3: Structured error object — compile/render/input failures surface as `{phase, message, sourceLine}` (sourceLine mapped back to the original input via the error-parser path); acceptance: an agent gets a parseable error pointing at the offending input line, not a raw g++ dump.
- F5.4: Distinct exit codes per phase — documented, stable exit codes distinguish e.g. usage error vs parse/compile error vs render/runtime error vs diff-mismatch; acceptance: a script can tell *why* a run failed from `$?` alone, and the codes are listed in `--help`/README.

### M6 — Packaging + GitHub release readiness
**Demonstration**: A fresh clone (or install per the published method) lets a new user run `--help`, follow the README quickstart end-to-end on a bundled example, and reproduce a render; a CI pipeline runs a smoke job on every push — `--help`, a sample render, and exit-code assertions — and is green.
**Out of scope**: new product features; replacing the VS Code extension; building a GUI (all out of project scope by the goal).
**Features**:
- F6.1: `--help` + usage surface — complete `--help` listing commands, flags, exit codes, and examples; acceptance: a new user discovers every subcommand/flag without reading source.
- F6.2: README + worked examples — quickstart, install/run instructions, and bundled runnable examples covering render, tree, overlay, diff, and config; acceptance: a newcomer reproduces each headline feature from copy-pasted commands.
- F6.3: Distributable package — the CLI is packaged for the chosen distribution channel (architect-decided) so an external user can install/run it without the dev tree; acceptance: a user installs and runs the CLI from outside the repo.
- F6.4: CI smoke pipeline — CI builds and runs a smoke suite (`--help`, sample render produces a PNG + tree, exit-code checks) on push; acceptance: a green CI badge proves the released CLI starts and renders the sample.
- F6.5: Release artifacts + changelog — a tagged GitHub release with artifacts and an updated `CHANGELOG.md` entry; acceptance: a user downloads a released build and the changelog states what shipped.

## Self-Review

- **Placeholder scan**: No `TBD`/`FIXME`/`???`/`<placeholder>` left. The one intentional unknown — headless `DumpTree` behavior — is not a placeholder; it is scoped as M0 spike feature F0.5 with a concrete ADR deliverable, and M1's schema (F1.1) is written to absorb either outcome (semantic tree if the bridge works, property-reconstructed via general enumeration if not), so no downstream feature is blocked on an unstated assumption.
- **Internal consistency**: Dependency graph is acyclic (M0 → M1 → {M2,M3,M5}; M2 → M4; {M2,M3,M4,M5} → M6) and every "Depends on" cell matches the prose graph. Stable IDs are introduced once (F1.3) and consumed by Set-of-Mark (F2.2), tree-diff (F4.2), and node↔image resolution (F2.4) without redefinition. Determinism (F1.4) underpins the verify loop (M4) and is stated where it is first guaranteed. Source-line provenance is reused consistently: harness `__tag` at F1.5 and the error-parser mapping at F5.3.
- **Scope check**: All five goal differentiators are mapped to features — (a) linked image+tree via stable IDs/Set-of-Mark → F2.1/F2.2 (+ F1.3); (b) verify loop image-diff + tree-diff → F4.1/F4.2/F4.3; (c) dual human (box tree F3.1, report F3.2, watch F3.4) + AI (token-bounded JSON F3.3); (d) config flags resolution/theme/dpr echoed in metadata → F5.1/F5.2; (e) structured errors `{phase,message,sourceLine}` + distinct exit codes → F5.3/F5.4. M0 is infra+spike only (no product features). Out-of-scope honored: not a GUI, not replacing the VS Code extension (infra-only reuse stated in the header and M6 out-of-scope). No library/runtime is named anywhere — only abstract roles (CLI language/runtime, render backend, image-diff/tree-diff). Features are at WU granularity (testable user-visible promises), not implementation steps. Final milestone (M6) covers packaging, README, `--help`, examples, CI smoke, and release artifacts as required.
- **Ambiguity**: One genuine OPEN remains and is deliberately deferred to M0's spike rather than guessed: the headless `DumpTree`/D-Bus outcome that branches the tree schema (semantic vs property-reconstructed). It is escalated below for the architect/test-planner's awareness; the plan is robust to either resolution because F1.1 is written to accept both. No other unresolved ambiguity.

OPEN_QUESTIONS:
- M0/F0.5: Does `Accessibility::Accessible::DumpTree` produce a semantic tree in the headless runtime container WITHOUT a live D-Bus session? Outcome decides M1's tree-source (free semantic tree vs property-reconstructed via `GetPropertyIndices` enumeration). To be answered by the M0 spike ADR before M1 schema work begins.
