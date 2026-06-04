# M0 — Build infra + a11y spike — spec

> Drafted by the spec-drafting agent at milestone start, against the FROZEN features F0.1–F0.5
> (`docs/autoplan/m0/feature-checklist.md`), the execution test plan (`docs/autoplan/m0/test-plan.md`),
> the architecture (`docs/autoplan/architecture.md`) and ADR-001/002/003/007.
> Decisions are already made in those ADRs — this spec *encodes* them into sequentially-implementable
> work units; it does not re-litigate the stack.
> Every assertion command below is **copied verbatim** from `test-plan.md` (cited per feature); the
> implementation agent must not regenerate or alter them.

---

## 1. Goal

Stand up the `dali-ui-preview` CLI project from an empty (`docs/`-only) repo so that a clean clone can
`npm install && npm run build` (zero errors) and `dali-ui-preview <bundled-sample> --image out/preview.png`
runs the full path — parse → render the user's **real** C++ in the runtime container under headless
Xvfb/offscreen → capture a non-empty PNG + print a **minimal** JSON node tree (per-node concrete type +
nesting) to stdout — and separately resolve the a11y spike with an ADR recording whether
`Accessibility::Accessible::DumpTree` yields a semantic tree headless **without a live D-Bus session**
and which tree-source the project takes.

---

## 2. Out of scope (deferred to M1+)

These are **frozen out** of M0 (feature-checklist.md "Out of scope (M0)" + architecture.md). Do **not**
build them now; if discovered as needs, file them to `docs/autoplan/m0/oos-queue.md`.

- **Rich / canonical tree schema** (full `{id, role, name, bounds{x,y,w,h}, key properties}` per node) — M1/F1.1. M0 emits only **concrete per-node type + nesting** (the existing `CollectActorMetadata` shape is sufficient).
- **Stable structural-path IDs + overlay marks** (ADR-004) — M2. No `id`/`mark` emission in M0.
- **`CalculateCurrentScreenExtents` frame-accurate bounds** replacing the hand-rolled bounds math (ADR-003/F1.2) — M1. M0 keeps the existing bounds as-is.
- **Set-of-Mark PNG overlay**, **image-diff**, **tree-diff**, **verdict/exit-code matrix** — M2/M4.
- **Config flags** beyond `--image` and `--version` (no `--theme`, `--resolution`, `--dpr`, `--max-depth/nodes`, `--baseline`, `--image-tag`, config-echo metadata) — M5.
- **Structured-error contract** (`errorParser` g++ → `{phase,message,sourceLine}` surfaced to the user) — M5. `errorParser.ts` is *vendored* in M0 (so a fresh clone is self-contained, ADR-007) but **not wired** into the CLI output path.
- **`DumpTree`-based semantic enrichment actually wired in** — M1. M0 only *probes/records* the headless behaviour (F0.5 spike); the guaranteed default stays the property-reconstructed walk (Inv-2).
- **Packaging / `npx` publish / GitHub release / CI smoke** — M6.
- **`watch` / `tree` / `overlay` / `diff` / `report` subcommands** — M3/M4. M0 has exactly one default command: `<input> --image <path>`.

---

## 3. Work units

Six work units, ordered for sequential single-threaded implementation; each is validatable before the
next begins. WU-1 is the root build gate; WU-2 vendors the assets a fresh clone needs; WU-3 templates the
harness; WU-4 wires the container render path (PNG); WU-5 wires the stdout tree; WU-6 is the a11y spike.

> **Shared facts for every WU (grounded in the sibling infra read directly):**
> - Render path = one-shot `docker run --rm` against **`ghcr.io/lwc0917/dali-preview-runtime:latest`** (present locally, ~1.19GB), entrypoint `dali-preview-entrypoint /work/source.cpp`, bind-mount host `workDir → /work`, env `PREVIEW_WIDTH/HEIGHT`, `GALLIUM_DRIVER=llvmpipe`, `LP_NUM_THREADS=0`, `EINA_LOG_*` silencers + `ccache`/shader named volumes — mirror `../src/dockerRuntime.ts buildAndCapture` exactly (ADR-002).  ⚠ The sibling's `DEFAULT_DOCKER_IMAGE` is `ghcr.io/dalihub/...`; the M0 default **must** be the `lwc0917` org per package.json/test-plan.
> - The vendored harness (`../server/preview_harness.cpp.template`) already: compiles the user's real C++ in `CreatePreviewUI()`, captures the PNG to `{{OUTPUT_PATH}}`, writes a JSON tree to `{{METADATA_PATH}}` via `ExportSceneMetadata`→`CollectActorMetadata`, and prints `OK:{{OUTPUT_PATH}}` to stdout on success (`CAPTURE_FAILED` to stderr on failure). M0 reuses this contract verbatim; it does **not** add ids/marks/extents/DumpTree.
> - That JSON tree's shape today: `{"root":{"name":"RootLayer","x":0,"y":0,"w":..,"h":..,"children":[ {"name":..,"type":"FlexLayout","x":..,..,"children":[ {"type":"TextLabel",..}, .. ]} ]}}`. **Children carry a concrete `type`; the synthetic `root` carries only `name`.** F0.4's assertion requires the **emitted-to-stdout** tree's *root node* to have a `type`/`typeName`/`className` field **and** a non-empty `children` — so the CLI must emit a root node that has a concrete type (see WU-5 acceptance for the exact, minimal resolution).
> - Host has **no `jq`** → JSON assertions use `node -e`. PNG sniffed via `file` + 8-byte magic. Node v24.14.1 / npm 11.11.0.

---

### WU-1 — Project skeleton + reproducible build + `--version`

**Satisfies:** F0.1.

**Files to touch (create):**
- `package.json` — `name` `dali-ui-preview`, `version` `0.1.0`, `bin` `{ "dali-ui-preview": "out/cli.js" }`, `main` `out/cli.js`, scripts `build` (`tsc -p ./`) + `watch` (`tsc -watch -p ./`) + `test`/`test:unit` (`c8 mocha out/test/unit/**/*.test.js --timeout 10000`, lifted from sibling), devDeps `typescript ^5.9.3` + `@types/node ^20` + `mocha`/`c8`/`chai`/`sinon` (+types) for tier-3, runtime deps `pngjs ^7.0.0` + `pixelmatch ^7.1.0` (already needed downstream, declared now so install is one-shot).
- `tsconfig.json` — `strict: true`, `module: commonjs`, `target: ES2020`, `outDir: out`, `rootDir: .`, `esModuleInterop: true`, `include: ["src/**/*.ts","test/**/*.ts"]`. (Copy sibling but **drop** the absolute `typeRoots` entry pointing at `/home/woochan/tizen/dali_preview/...` — keep only `node_modules/@types`.)
- `src/cli.ts` — entrypoint with a `#!/usr/bin/env node` shebang; parses argv; on `--version`/`-v` prints the `version` read from `package.json` (a `^[0-9]+\.[0-9]+\.[0-9]+` string) and exits 0; a `--help`/no-args path may print a one-line usage. (Real render wiring lands in WU-4/WU-5; this WU only needs the build to succeed and `--version` to work.)
- `.gitignore` — ignore `out/`, `node_modules/`.
- `CHANGELOG.md` — seed with an `## 0.1.0 — M0` entry (PR guideline: update changelog).

**Acceptance criteria (user perspective):** From a clean checkout, `npm install` then `npm run build` completes with **zero** TypeScript errors and produces a runnable `out/cli.js`; `dali-ui-preview --version` (via `node out/cli.js --version`) prints a semver-like string (e.g. `0.1.0`) and exits 0.

**Execution test — Tier 3** (cite F0.1, test-plan.md §F0.1; ✋ no):
```bash
set -e
npm install
npm run build                       # tsc → out/ ; MUST exit 0 with zero errors
test -f out/cli.js                  # runnable entrypoint produced
VER=$(node out/cli.js --version)    # dev invocation of the bin entry
echo "version => $VER"
echo "$VER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'   # semver-like
```

**Dependencies:** none (root gate — a broken build sinks every later WU).

---

### WU-2 — Vendor paperclip infra + canonical sample fixture

**Satisfies:** F0.2 (the sample fixture is the *tested* deliverable). Also lays the vendored-source groundwork ADR-007 requires for WU-3/WU-5 and for a self-contained clone — but only the sample is asserted in M0.

**Files to touch (create):**
- `samples/hello-dali.preview.dali.cpp` — **copy verbatim** from `../samples/hello-dali.preview.dali.cpp` (the column-centred dark `0x1e1e2e` UI with `Label::New("Hello, Dali!")` 48px white + a gray 18px subtitle, built via a `FlexLayout::New()` chain). This is the fixed input every later milestone runs against — commit it (git-tracked).
- `server/preview_harness.cpp.template` — **copy verbatim** from `../server/preview_harness.cpp.template`; prepend a provenance header comment (paperclip origin + that it was copied for M0, per ADR-007). No behavioural edits in this WU.
- `src/cppParser.ts` — copy from `../src/cppParser.ts` as-is (already vscode-free, self-contained TS); add provenance header.
- `src/flexMetadata.ts` — copy from `../src/flexMetadata.ts` as-is; add provenance header.
- `src/errorParser.ts` — copy from `../src/errorParser.ts` **with the `vscode` dependency stripped**: drop `import * as vscode` and the `errorsToDiagnostics` export (the VS Code Diagnostic adapter); **keep** `parseGccErrors`, `getHarnessCodeOffset`/`getPluginCodeOffset`, `formatRawError`, `formatErrorsForDisplay`, and the `ParsedError` interface. (Vendored for clone-completeness; **not** wired into CLI output in M0 — that is M5.)

**Acceptance criteria (user perspective):** `samples/hello-dali.preview.dali.cpp` exists, is non-empty, contains the literal `Hello, Dali!`, contains genuine preview C++ (a `FlexLayout::New` chain / a `return`), and is git-tracked. The vendored TS files compile cleanly under WU-1's `tsc` (i.e. `errorParser.ts` no longer references `vscode`, so `npm run build` stays green).

**Execution test — Tier 3** (cite F0.2, test-plan.md §F0.2; ✋ no):
```bash
SAMPLE=samples/hello-dali.preview.dali.cpp
test -s "$SAMPLE"                                  # exists and is non-empty
grep -q 'Hello, Dali!' "$SAMPLE"                   # the canonical label
grep -Eq 'FlexLayout::New|return ' "$SAMPLE"       # is real preview C++, not a stub
git ls-files --error-unmatch "$SAMPLE"             # committed (tracked), not stray
echo "sample ok => $SAMPLE"
```
> Secondary gate (no new test invented — reuse F0.1's build smoke): after vendoring, `npm run build` must still exit 0, proving the vscode-stripped `errorParser.ts` and the other vendored TS compile.

**Dependencies:** WU-1 (needs the repo skeleton, `tsconfig`, and `tsc` build so the vendored TS is validated).

---

### WU-3 — Input resolver + harness templater (host side, no container yet)

**Satisfies:** enabling step for F0.3/F0.4 (data-flow steps 1–2 in architecture.md: *Input → parse* and *Template*). Not independently a frozen feature; tested via the F0.1 build smoke (its output is consumed by WU-4/WU-5 which carry the F0.3/F0.4 assertions).

**Files to touch (create):**
- `src/inputResolver.ts` — resolve the CLI input **file path** to raw preview C++ + a 0-based `startLine`: for a `*.preview.dali.cpp` file, the whole file body is the preview code (preview-file mode); detect `// @dali-preview-begin` / `// @dali-preview-end` markers for a marker-mode `.cpp` (return the region + its start line). (M0 only needs the file path → preview-file mode for the sample; marker mode may be minimal. No stdin/inline-snippet modes in M0 — those are later.)
- `src/harnessTemplater.ts` — fill the vendored `server/preview_harness.cpp.template`: substitute `{{USER_CODE}}` (the resolved raw C++ — Inv-5: the user's verbatim source), `{{PREVIEW_WIDTH}}`/`{{PREVIEW_HEIGHT}}` (default `1024`×`600`, matching sibling defaults), `{{FONT_SETUP}}` (use the sibling's font-setup block / empty-safe default), `{{BACKGROUND_COLOR}}` (a default `Color::BLACK`-class value), and the in-container `{{OUTPUT_PATH}}` (`/work/preview.png`) + `{{METADATA_PATH}}` (`/work/tree.json`). Return the fully-substituted source string ready to write to `workDir/source.cpp`. (No theme/dpr/resolution flags — those are M5; bake fixed defaults.)

**Acceptance criteria (user perspective):** Given the sample path, the templater produces a complete C++ source string with **no remaining `{{...}}` placeholders** and the sample's exact preview code embedded in the `CreatePreviewUI()` body. (Validated indirectly: WU-4 compiles this string in-container and it must build+render.)

**Execution test — Tier 3** (no new test invented; reuse the F0.1 build smoke — these modules must compile under `tsc`):
```bash
set -e
npm install
npm run build                       # tsc → out/ ; MUST exit 0 with zero errors
test -f out/cli.js                  # runnable entrypoint produced
VER=$(node out/cli.js --version)    # dev invocation of the bin entry
echo "version => $VER"
echo "$VER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'   # semver-like
```
> Functional correctness of the produced source is *proven by WU-4's render* (a missing/extra placeholder makes the container compile fail → WU-4's F0.3 assertion fails). M0 adds no standalone unit test for the templater (templater/parser unit tests are a tier-3 nicety deferred; the render is the binding contract).

**Dependencies:** WU-2 (needs the vendored harness template + `cppParser` to resolve/parse input).

---

### WU-4 — Container render path → non-empty PNG at `--image`

**Satisfies:** F0.3.

**Files to touch (create / wire):**
- `src/dockerRunner.ts` — **adapt** `../src/dockerRuntime.ts`'s `buildAndCapture` (ADR-002): `docker info` preflight (the sibling `isAvailable` pattern) → fail loudly with a clear message if the daemon is unreachable; create a temp `workDir`; write `source.cpp`; `docker run --rm -v workDir:/work -v dali-preview-ccache:/cache -v dali-preview-shader-cache:/root/.cache/dali_common_caches -e PREVIEW_WIDTH=.. -e PREVIEW_HEIGHT=.. -e EINA_LOG_* -e LP_NUM_THREADS=0 -e GALLIUM_DRIVER=llvmpipe <image:tag> /work/source.cpp`; parse exit code + `OK:` stdout marker; read back the PNG (and the metadata JSON, consumed in WU-5). **Default image = `ghcr.io/lwc0917/dali-preview-runtime`, tag `latest`** (NOT the sibling's `dalihub` default). Strip the sibling's `getLogger`/vscode-coupled logging to a plain stderr/console diagnostic. Timeout 90s (first un-cached compile).
- `src/cli.ts` — wire the default command: parse `<input>` (positional) + `--image <path>`; call `inputResolver` → `harnessTemplater` → `dockerRunner`; on success copy/move the container-produced PNG to the user-given `--image` path; map success→exit 0, render/compile failure→non-zero exit with a diagnostic.

**Acceptance criteria (user perspective):** `dali-ui-preview samples/hello-dali.preview.dali.cpp --image /tmp/m0-f0.3-preview.png` exits 0 and writes a real, non-empty PNG (PNG magic bytes, > 100 bytes) to that path; the image shows a dark column-centred large white "Hello, Dali!" heading with a smaller gray subtitle, no obvious render corruption.

**Execution test — Tier 2 (+ §G vision judge)** (cite F0.3, test-plan.md §F0.3; **✋ yes** — first render, no golden, software-GL DALi → vision judge per §G option ③):
```bash
OUT=/tmp/m0-f0.3-preview.png
rm -f "$OUT"
node out/cli.js samples/hello-dali.preview.dali.cpp --image "$OUT"
RC=$?
echo "exit=$RC"
[ "$RC" -eq 0 ]                                    # CLI succeeded
test -s "$OUT"                                     # PNG written and non-empty
file "$OUT" | grep -q 'PNG image data'            # real PNG (magic bytes), not a stray text/error file
# belt-and-suspenders magic-byte check (no 'file' util dependency):
node -e 'const b=require("fs").readFileSync(process.argv[1]);const sig=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);process.exit(b.length>100 && b.subarray(0,8).equals(sig)?0:1)' "$OUT"
```
Timeout: 90s (first un-cached container compile).
> ✋ **Visual hold:** the orchestrator Reads this PNG and judges it against *"dark (near-black/navy) background, a column-centered large white 'Hello, Dali!' heading with a smaller gray subtitle line below it, no obvious render corruption."* Verdict `EQUIVALENT`/`MINOR_DIFF`/`NO_GOLDEN_BUT_LOOKS_RIGHT` ⇒ auto-baseline to `tests/golden/hello-dali.png` and queue in `docs/autoplan/m0/visual-holds.md` for human sign-off; `MAJOR_DIFF` ⇒ do **not** create the baseline, FAIL.

**Dependencies:** WU-3 (needs the templated source) → WU-2, WU-1. **Hard pre-conditions:** docker daemon reachable by this user (`docker info` succeeds) **and** `ghcr.io/lwc0917/dali-preview-runtime:latest` present locally. Absent docker/image ⇒ hard FAIL gate (the render path cannot degrade — the feature *is* the render).

---

### WU-5 — Minimal JSON tree on stdout

**Satisfies:** F0.4.

**Files to touch (create / wire):**
- `src/treeModel.ts` — read back the harness-produced metadata JSON (`workDir/tree.json`) and produce the **minimal** in-memory node tree the CLI prints. M0 schema = exactly what `CollectActorMetadata` already emits: per node a concrete **`type`** + a **`children`** array (nesting). No ids/marks/role/bounds-richness (those are M1/M2). **One required minimal adjustment:** the synthetic top-level `root` node from `ExportSceneMetadata` currently carries only `name:"RootLayer"` and no `type`; F0.4 asserts the **stdout** tree's *root node* has a `type`/`typeName`/`className` field. Resolve minimally by **either** (a) the CLI emitting the tree with the root node given a concrete type (e.g. set `root.type = "RootLayer"` / `"Layer"` when building `treeModel`), **or** (b) the CLI emitting the first real child (the `FlexLayout`) as the stdout root. Pick the smallest change that makes the root carry a non-empty concrete type **and** a non-empty `children` array; document the choice in a code comment. Do **not** invent the rich schema.
- `src/cli.ts` — after a successful render, print the minimal tree as JSON to **stdout** (Inv-6: stdout JSON is the primary contract). Keep `--image` writing the PNG. Ensure **only** the JSON goes to stdout (diagnostics/`OK:`/compile logs → stderr) so stdout parses cleanly.
- (Optional, if trivial) `src/formatters/jsonFormatter.ts` — a thin pure function `tree → JSON string`; acceptable to inline in `cli.ts` for M0 since there is exactly one formatter. (Full formatter suite is M3.)

**Acceptance criteria (user perspective):** The same single invocation that writes the PNG also prints **valid JSON** to stdout whose root node has a non-empty `type`/`typeName`/`className` **and** a non-empty `children`/`nodes` array, and whose first child also carries a concrete type (proving "per-node concrete type + nesting" for ≥2 levels). CLI exits 0.

**Execution test — Tier 2** (cite F0.4, test-plan.md §F0.4; ✋ no — JSON shape is deterministically auto-assertable):
```bash
OUT=/tmp/m0-f0.4-preview.png
rm -f "$OUT"
node out/cli.js samples/hello-dali.preview.dali.cpp --image "$OUT" > /tmp/m0-tree.json 2>/tmp/m0-tree.err
echo "exit=$?"
# stdout must be parseable JSON whose tree carries a concrete per-node type AND nesting (children):
node -e '
  const fs = require("fs");
  const txt = fs.readFileSync("/tmp/m0-tree.json", "utf8").trim();
  const tree = JSON.parse(txt);                       // throws -> non-zero -> FAIL if stdout is not JSON
  const root = Array.isArray(tree) ? tree[0] : (tree.root ?? tree.tree ?? tree);
  const typeKey = ["type","typeName","className"].find(k => root && typeof root[k] === "string" && root[k].length);
  const kidsKey = ["children","nodes"].find(k => root && Array.isArray(root[k]));
  if (!typeKey) { console.error("no concrete per-node type field"); process.exit(1); }
  if (!kidsKey || root[kidsKey].length < 1) { console.error("no nesting / no children"); process.exit(1); }
  const child = root[kidsKey][0];
  const childType = ["type","typeName","className"].find(k => child && typeof child[k] === "string" && child[k].length);
  if (!childType) { console.error("child has no concrete type"); process.exit(1); }
  console.log("tree ok: root type =", root[typeKey], "| children =", root[kidsKey].length);
'
```
Timeout: 90s (shares the render; warm ccache makes reruns fast).

**Dependencies:** WU-4 (same invocation emits both PNG and tree; the metadata JSON is read back by the same `dockerRunner`). Transitively WU-1..WU-3. Same docker pre-conditions as WU-4.

---

### WU-6 — A11y-bridge spike + decision record (ADR-008)

**Satisfies:** F0.5 (⚠️ spike).

**Files to touch (create):**
- `docs/autoplan/m0/spike-dumptree-output.txt` — the **captured headless artifact**: run `Accessibility::Accessible::Get(actor)->DumpTree(...)` (or the minimal equivalent probe) **inside** `ghcr.io/lwc0917/dali-preview-runtime:latest` **without a live D-Bus session**, and capture the real stdout/stderr — i.e. either the DumpTree output **or** the AT-SPI/D-Bus/bridge error that fires headless. May be captured by driving the harness/CLI **or** via a direct one-shot `docker run … bash -c '…DumpTree…'`. Must contain enough evidence to show the probe actually ran headless (mention of `DumpTree`/`D-Bus`/`AT-SPI`/`accessibility`/`bridge`/`reconstruct`). (The sibling `previewServer.cpp` already filters `ERROR: DALI:.*(dbus|Accessibility|DBusClient)` noise headless — that is the expected class of result.)
- `docs/autoplan/adr/ADR-008-a11y-spike-result.md` — the decision record. Must state a **definite yes/no** on whether `DumpTree` yields a semantic tree **headless-without-D-Bus**; name the **chosen tree-source** (property-reconstructed walk as the guaranteed default per ADR-003/Inv-2, with DumpTree as optional enrichment iff available); record the resulting **M1 tree-schema direction**; contain **no placeholder tokens** (`TBD`/`TODO`/`FIXME`/`???`/"to be decided"). Use the standard ADR sections (Status `accepted`, Context, Decision, Consequences, Affected milestones) consistent with ADR-001..007.

**Acceptance criteria (user perspective):** Both artifacts exist and are non-empty; the `.txt` shows the spike was actually run headless (DumpTree output or the bridge/D-Bus error); the ADR records a definite yes/no verdict, names the chosen tree-source, and is not a placeholder. The verdict faithfully reflects what the captured output shows.

**Execution test — Tier 3** (cite F0.5, test-plan.md §F0.5; **✋ yes** — semantic correctness of the verdict vs the artifact is a human judgment the grep cannot make):
```bash
ART=docs/autoplan/m0/spike-dumptree-output.txt
ADR=docs/autoplan/adr/ADR-008-a11y-spike-result.md
# 1. Both artifacts exist and are non-empty:
test -s "$ART"
test -s "$ADR"
# 2. The captured artifact shows the spike was actually run headless (DumpTree output OR the bridge/D-Bus error):
grep -Eqi 'dumptree|d-?bus|dbus|atspi|at-spi|accessib|bridge|reconstruct' "$ART"
# 3. The ADR records a DEFINITE yes/no verdict AND the chosen tree-source path:
grep -Eqi 'headless|d-?bus|without a (live )?d-?bus' "$ADR"
grep -Eqi '\b(yes|no|works|does not work|unavailable|available|absent|present)\b' "$ADR"
grep -Eqi 'property[- ]?reconstruct|reconstructed walk|DumpTree|tree[- ]?source|semanticsSource' "$ADR"
# 4. The ADR is not a placeholder:
! grep -Eqi 'TBD|TODO|FIXME|\?\?\?|to be (authored|decided|determined)' "$ADR"
echo "spike artifacts present and ADR states a verdict"
```
> ✋ **Human hold:** confirm the ADR's yes/no faithfully reflects the captured DumpTree/error output and that the M1 tree-schema direction is sound. The architecture is robust either way (ADR-003/Inv-2: property-reconstructed walk is the guaranteed default), so this records the empirical result; it does **not** block M1.

**Dependencies:** WU-1 (build green, so harness/CLI plumbing exists to drive the probe — though the spike may also be captured via a direct `docker run`). **Pre-conditions:** docker + the runtime image present (the spike must be RUN inside the image, without a live D-Bus session). Independent of WU-4/WU-5's render-success (the probe can be a standalone `docker run`), so it may proceed in parallel with WU-4/WU-5 once WU-1 is green — but is ordered last here for a clean sequential validation pass.

---

## 4. Dependency order

```
WU-1  (skeleton + build + --version)            ── root gate
  │
  ├──> WU-2  (vendor infra + sample fixture)     [F0.2]
  │       │
  │       └──> WU-3  (inputResolver + harnessTemplater)
  │               │
  │               └──> WU-4  (dockerRunner + CLI render → PNG)   [F0.3] ✋
  │                       │
  │                       └──> WU-5  (treeModel + stdout JSON)   [F0.4]
  │
  └──> WU-6  (a11y spike + ADR-008)              [F0.5] ✋  (needs only WU-1 + docker/image;
                                                            run last for clean sequential validation)
```

Linear critical path for the render demo: **WU-1 → WU-2 → WU-3 → WU-4 → WU-5**.
**WU-6** branches off WU-1 (needs the image + a headless run, not the full CLI render path) and is validated last.

| WU | Title | Feature(s) | Tier | ✋ | Needs |
|---|---|---|---|---|---|
| WU-1 | Skeleton + build + `--version` | F0.1 | 3 | no | — |
| WU-2 | Vendor infra + sample fixture | F0.2 | 3 | no | WU-1 |
| WU-3 | inputResolver + harnessTemplater | (enables F0.3/F0.4) | 3 (build smoke) | no | WU-2 |
| WU-4 | dockerRunner + CLI render → PNG | F0.3 | 2 (+§G ③) | **yes** | WU-3 |
| WU-5 | treeModel + stdout JSON | F0.4 | 2 | no | WU-4 |
| WU-6 | a11y spike + ADR-008 | F0.5 | 3 | **yes** | WU-1 |

Every WU carries at least a Tier-3 smoke (WU-1/WU-2/WU-3/WU-6 are Tier-3; WU-4/WU-5 are Tier-2, which strictly dominates a Tier-3 smoke for a CLI since §E has no Tier 1). The two not-fully-machine-gradable features each carry a ✋ **and** a mechanical fallback: WU-4 (PNG magic bytes) + WU-6 (artifact-existence + verdict-grep).

---

## Self-Review

**Placeholder scan.** No `TBD`/`FIXME`/`???`/unresolved `<...>` left in any WU, acceptance criterion, or command. The only deliberately-forward token is **ADR-008**, which *is the artifact WU-6 authors* (the spike's empirical yes/no) — mirrored from architecture.md's intentional ADR-008 forward-ref, not a placeholder. The `{{...}}` tokens in WU-3 are literal harness-template placeholders (the substitution targets), not unfilled spec gaps. Every assertion block is copied verbatim from `test-plan.md` (F0.1/F0.2/F0.3/F0.4/F0.5) — none regenerated; WU-3 reuses the F0.1 build smoke rather than inventing a new test (constraint: do not invent tests).

**Internal consistency.** Each frozen feature maps to exactly one *tested* WU (F0.1→WU-1, F0.2→WU-2, F0.3→WU-4, F0.4→WU-5, F0.5→WU-6); WU-3 is a pure enabling split (host-side parse/template) whose output is bound by WU-4's render, so it carries no independent frozen-feature assertion — it reuses the F0.1 build smoke. Tiers, ✋ markers, golden/auto-baseline path (`tests/golden/hello-dali.png`), visual-holds queue (`docs/autoplan/m0/visual-holds.md`), and timeouts match `test-plan.md` exactly. The render contract (`docker run --rm … <image> /work/source.cpp` → exit 0 + `OK:` stdout + metadata JSON read-back, image `ghcr.io/lwc0917/dali-preview-runtime:latest`) matches `dockerRuntime.buildAndCapture` + `preview_harness.cpp.template` as read directly. ADRs are encoded, not re-litigated: ADR-001 (Node+TS strict, `bin` `dali-ui-preview`, `tsc`→`out/`) in WU-1; ADR-002 (one-shot `docker run`, mirror `buildAndCapture`) in WU-4; ADR-003/Inv-2 (property-reconstructed default; DumpTree only probed, not wired) in WU-5/WU-6 + Out-of-scope; ADR-007 (vendor harness/cppParser/flexMetadata/errorParser-vscode-stripped + sample; image referenced by GHCR tag) in WU-2.

**Scope check.** Exactly the five FROZEN features F0.1–F0.5 are covered, no more. Explicitly deferred and listed in §2: rich tree schema, stable IDs + overlay marks, `CalculateCurrentScreenExtents` bounds, diffing/verdict, config flags beyond `--image`/`--version`, structured-error wiring, DumpTree enrichment, packaging, and the `watch`/`tree`/`overlay`/`diff` subcommands. `errorParser.ts` is vendored (clone-completeness, ADR-007) but pointedly **not** wired into output (M5). No pixel-diff golden test is planned (the golden does not exist yet — §G first-run uses the vision judge); no flags beyond `--image`/`--version` are introduced (the only M0 surface in the demonstration). The auto-baseline `tests/golden/hello-dali.png` is *written-once* via WU-4's vision verdict and only *consumed* as a pixel golden from M1/M4 (project-profile.md `tier1: yes-after-M0`).

**Ambiguity → resolve or escalate.**
- *F0.4 stdout root-node type* — the existing `ExportSceneMetadata` synthetic `root` carries only `name`, but F0.4 asserts the stdout root has a `type`/`typeName`/`className`. **Resolved in WU-5** by requiring the smallest change that gives the emitted root a concrete type + non-empty children (set `root.type` when building `treeModel`, or emit the first real child as root) — explicitly *not* the rich M1 schema. No escalation.
- *Default image org* — sibling `dockerRuntime.ts` defaults to `ghcr.io/dalihub/...`, but package.json/test-plan standardize on `ghcr.io/lwc0917/...`. **Resolved**: WU-4 hard-codes the `lwc0917` default (flagged in the shared-facts note and WU-4). No escalation.
- *Where the spike runs (F0.5)* — through the CLI/harness or a direct one-shot `docker run … bash -c '…DumpTree…'`. The test asserts only the two artifacts + a definite verdict, so it is agnostic. **Resolved** (WU-6 permits either). No escalation.
- *Templater/parser unit tests* — M0 adds none; their correctness is bound by WU-4's render (a bad template fails the in-container compile). **Resolved** as a deliberate scope choice (tier-3 unit suite for formatters/parser is an M1+ nicety; test-plan.md does not require it for M0). No escalation.

OPEN_QUESTIONS:
- none. (The single architectural open — the F0.5 empirical DumpTree-headless yes/no — is the *deliverable WU-6 produces*, captured by its two artifacts + ✋, exactly as architecture.md OPEN_QUESTIONS intends; it does not block M1 per ADR-003/Inv-2.)
