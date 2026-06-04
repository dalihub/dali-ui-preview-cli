# Final External Review — dali-ui-preview (M0–M6)

Reviewer: independent final reviewer. Method: ran the LIVE CLI (`out/cli.js`)
against the real runtime image (`ghcr.io/lwc0917/dali-preview-runtime:latest`,
present locally) with Docker 29.5.3, plus full source/test inspection. Fresh
opinion; prior milestone claims were not trusted. No source files were modified.

---
## Verdict: CONCERN

The CLI is real, complete in scope, and genuinely works end-to-end: every
headline feature renders live, the AI-agent contract (pure-JSON stdout / stderr
diagnostics / branchable exit codes / determinism) holds, and the test suite is
substantial and honest. It is *close* to release-ready. The verdict is CONCERN
(not PASS) because of one genuine correctness bug in a headline field
(`sourceLine` is off by one / 0-based, contradicting the documented "1-based")
and two real-but-minor issues (a dangling `diffPngPath` in the verify verdict;
several doc-vs-behavior drifts in the README examples/schema). None of these
block the core loop; all are fixable with small, local changes.

---
## What works (verified live)

- **`npm test` is genuine.** Live run: **116 passing (4s)**, exit 0. Opened
  `structuredError.test.ts`, `imageDiff.test.ts`, `treeQuery.test.ts` — all have
  real assertions (offset math, half-open edge rule, area-tie-by-mark, 0.01
  boundary inclusivity, dimension-mismatch contract). `grep "expect(true)"` over
  the whole test tree returns nothing. 12 test files, 120 `it()` blocks.

- **Core agent loop works.** `node out/cli.js samples/hello-dali.preview.dali.cpp`
  → exit 0, stdout is a single parseable JSON line, stderr empty. Every documented
  node field is present live: `id, mark, type, role, name, bounds, sourceLine,
  semanticsSource, properties, flexProps, children`, and `root.meta`.

- **Three input modes are identical.** file vs `-` (stdin positional) vs piped
  stdin vs `--code` all produce **byte-identical** trees (`cmp` clean across all
  four).

- **Determinism holds.** Two renders of the fixture are **byte-identical**
  (`cmp /tmp/r1.json /tmp/r2.json` → identical).

- **`--image`** writes a valid `1024x600` RGBA PNG; stdout is byte-identical to
  the bare render (orthogonal, per Inv-6).

- **`--overlay`** writes a real Set-of-Mark PNG. Read the PNG: numbered magenta
  boxes are visibly drawn around the flex container and both labels (marks 3/4/5),
  matching the `mark` values in the tree. stdout still carries the full tree.

- **`--at` / `--node`** work and are mutually exclusive. `--at 500,290` returns
  the smallest containing node `{"id":"0/1/0","mark":4,...}`; off-canvas `--at
  5000,5000` returns `{"at":[5000,5000],"node":null}`; `--node 0/1/0` returns its
  region; bogus `--node 9/9/9` returns `null`; `--node 0` returns the root region.
  Degenerate `CameraActor` boxes are never matched.

- **`--format tree`** prints the box-drawing tree matching the README format
  (`┠╴`/`┖╴`/`┃` connectors, `#mark`, `[id]`, `(WxH @ x,y)`).

- **`--report html` / `--report md`** both write self-contained reports: base64
  `data:image/png` embed + box-tree + node `<table>` (HTML) / pipe-table (MD).
  stdout still carries the full JSON tree.

- **`--max-depth` / `--max-nodes`** are correctly bounded: `--max-depth 1` → 4
  nodes (root + 3 children, no grandchildren) with a `truncated:true` marker;
  `--max-nodes 3` → exactly 3 nodes with the marker.

- **Verify loop + exit codes.** `--update-baseline --baseline p.png
  --baseline-tree p.json` writes both, stdout empty (0 bytes), exit 0. Verify on
  matching input → `{"match":true,...}` exit **0**. Verify on a divergent render
  → `{"match":false,...}` exit **20** with a real image ratio (0.0131) and id-keyed
  tree diff. `--threshold 0.5` flips the same divergent image to pass (exit 0).
  Image-only and tree-only verify both work.

- **`--resolution` / `--theme` / `--dpr` change the render AND echo meta.**
  `--resolution 800x480 --theme light --dpr 2` → `root.meta` echoes the LOGICAL
  `{800x480, light, 2}`, root `bounds` and the PNG are the DEVICE size `1600x960`.
  `--theme` genuinely changes pixels: on code that does not paint its own
  background, the top-left corner is `(0,0,0,255)` dark vs `(255,255,255,255)`
  light. (The README's quickstart fixture paints a full-canvas background, which
  masks the theme — that's why a naive dark-vs-light diff of the fixture is
  identical; theme itself is not a no-op.)

- **`--watch` works.** Rejects all three non-file inputs (`--code`, `-`, piped
  stdin) with exit 1. Live: started in background, first emission appeared, then
  editing the file produced a second emission whose label `bounds` changed
  (`x:381 w:262` → `x:341 w:342`) reflecting the longer text — i.e. it actually
  re-rendered.

- **Structured errors + exit codes.** Broken code → exit **10**, stdout **empty
  (0 bytes)**, stderr a single JSON line `{"phase":"compile","message":"'Banana'
  has not been declared","sourceLine":N}`. All usage errors (unknown flag, both
  `--at`+`--node`, `--code`+positional, empty input, missing file, every
  malformed flag value, every illegal flag combo) → exit **1** with a clear
  message and **0-byte stdout**. Docker-unavailable preflight maps to exit **12**
  (code path verified; not exercised live to keep this review read-only).

- **Release artifacts.** `npm pack --dry-run` ships `out/cli.js` +
  `server/preview_harness.cpp.template` + README + samples + CHANGELOG (34
  files). **No `src/*.ts` shipped.** **No vendored DALi library source** — only
  the harness `.cpp.template` (placeholders, honestly headed "VENDORED from
  paperclip ... ADR-007") and the sample. `--help` is complete (every flag parsed
  in `cli.ts` is documented; the only help-not-code entries are `--help`/`--version`
  themselves). CI yaml present and honest (build + test + `--version`/`--help`
  smoke; documents that the docker render path needs a self-hosted runner).

---
## Findings / gaps (with severity)

### [MEDIUM] `sourceLine` is off by one (0-based) — contradicts documented "1-based"
The headline source-mapping field is wrong per its own spec. Measured live
against the canonical fixture `samples/hello-dali.preview.dali.cpp`:
- `Label::New("Hello, Dali!")` is on **file line 21** → live `sourceLine: 20`.
- second `Label::New(...)` on **file line 25** → live `sourceLine: 24`.
- `FlexLayout::New()` on **file line 13** → live `sourceLine: 12`.

Same N−1 result in marker mode (`@dali-preview-begin`): a `Label::New` on file
line 6 reports `sourceLine: 5`. README `README.md:261` states `sourceLine` is
"1-based line in your source." Root cause: `src/cppParser.ts:278`
`const sourceLine = (typeToken.line - 1) + this.startLineOffset;` emits a
**0-based** line, and `inputResolver` feeds a **0-based** `startLine`
(`src/inputResolver.ts` "startLine is 0" / "0-based index"). The pipeline is
internally consistent at 0-based; only the public contract is violated. Impact:
an agent (or a human) that opens `sourceLine` lands one line **above** the real
construct — e.g. on `.Children({` instead of the label. (Note: the README's own
quickstart JSON shows `20`/`24`, so README *examples* agree with the buggy
output while the README *schema row* says 1-based — internally contradictory.)
Fix is one line (`+1` at emission, or make `startLine` 1-based) but is **not**
applied here per the review's no-edit rule.

### [LOW-MEDIUM] Verify verdict advertises a `diffPngPath` that no longer exists
The verify verdict JSON includes
`image.diffPngPath: "/tmp/.../dali-ui-preview-XXXX/preview.png.diff.png"`, but
that path is inside the temp `workDir` which `runVerifyOrUpdate` deletes in its
`finally` (`cleanupWorkDir(workDir)`, `src/cli.ts:757-759`). Verified live:
the advertised file is **MISSING** on disk after the process exits. So an agent
that tries to open the diff image gets ENOENT. `imageDiff` defaults the diff to
`<actual>.diff.png` next to the actual PNG (`src/diff/imageDiff.ts:137-143`), and
the actual PNG lives in the temp dir; the CLI never copies the diff out and never
exposes a flag to place it. Also: `diffPngPath` is **undocumented** in
README/`--help`. Either drop it from the verdict, copy it somewhere durable, or
add a `--diff <png>` flag. (The underlying `imageDiff` is correct — its unit test
writes and re-reads the diff in a dir it controls.)

### [LOW] README examples/schema drift from live output
The README is accurate to the real **flags** (no invented flags), but several
example/schema details no longer match the live tree:
- **`name` of labels.** README quickstart shows `"name": "Hello, Dali!"`; live
  label nodes have `"name": ""` (label text is not surfaced as `name`). The
  `--format tree` example in README (`LabelImpl "Hello, Dali!"`) likewise shows
  text that the live tree does not emit (`LabelImpl ""`).
- **`flexProps` shape.** README schema/quickstart shows a **string array**
  (`"flexProps": ["direction", ...]`); live it is an **object**
  (`"flexProps": {"direction":"COLUMN","alignItems":"CENTER",...}`).
- **Node count / cameras.** README quickstart shows 5 nodes with a single leading
  `CameraActor`; the live tree has **6** nodes with **two** `CameraActor`s
  (`0/0` and `0/2`, leading and trailing).
- **Undocumented fields.** Live nodes carry `visible` and `opacity` keys not in
  the README schema table.
None of these break the contract, but they will mislead an agent that hard-codes
the documented shapes.

### [LOW] Compile-error `sourceLine: 0` for `--code` input
`--code 'return Banana::New("x");'` → `{"phase":"compile",...,"sourceLine":0}`.
With `--code` there is no source file (`startLine` 0) and the error maps to
0-based user line 0, so `sourceLine: 0` — not a valid 1-based line and arguably
should be `null` (the README's "when none could be mapped" semantics) or `1`.
Same 0-based root cause as the main finding.

### [LOW] Coverage instrumentation reports 0%
`npm test` runs `c8 mocha out/...` but the coverage summary is
`All files | 0 | 0 | 0 | 0` (Unknown%). c8 is not actually instrumenting the
compiled sources (no `src` include / source-map wiring), so the coverage gate is
vacuous. Tests themselves are real; only the *coverage number* is meaningless.

### [LOW] Compiled tests are shipped in the npm tarball
`files: ["out/"]` pulls `out/test/unit/*.test.js` (12 files, ~90 KB) into the
published package. Harmless but unnecessary; a `.npmignore` or a `files` entry of
`out/**/*.js` excluding `out/test` would trim it.

### [INFO] `--watch` emits nothing between renders
Watch stderr is silent (no "watching"/"re-rendering" line), so an interactive
user sees no feedback between edits. stdout-per-render is correct; this is purely
a UX nicety.

---
## Release-readiness checklist
- **npm test:** 116 passing (live, exit 0); genuine assertions, no `expect(true)`.
- **help:** OK — complete; every parsed flag documented; `--version`→`0.1.0`,
  `-v`/`-h` aliases work.
- **README accurate?** Flags: YES (no invented flags). Examples/schema: PARTIAL —
  `sourceLine` "1-based" claim is wrong (see MEDIUM), and `name`/`flexProps`/node-
  count/`visible`/`opacity` examples drift from live output (see LOW).
- **npm pack ships harness?** YES — `out/cli.js` + `server/preview_harness.cpp.template`
  + README/samples/CHANGELOG (34 files); no `src/*.ts`.
- **no DALi mods/vendored source?** YES — only the harness template (placeholders)
  and the sample; no DALi library code vendored; no source edited during review.
- **CI yaml present?** YES (`.github/workflows/ci.yml`): build + test + CLI smoke.

---
## Could be stronger / follow-up (concrete)

1. **Fix the `sourceLine` off-by-one.** `src/cppParser.ts:278` — change
   `(typeToken.line - 1) + this.startLineOffset` to a 1-based result (e.g.
   `typeToken.line + this.startLineOffset` with a 1-based `startLine`, or `+1` at
   emission), update marker-mode `startLine` accordingly, and add a regression
   test asserting `sourceLine === 21` for `Label::New("Hello, Dali!")` in the
   sample. This is the one change that moves the verdict to PASS.

2. **Make `diffPngPath` durable or drop it.** In `runVerifyOrUpdate`
   (`src/cli.ts:744-756`), either pass an `imageDiff` `diffPngPath` pointing at a
   user-controlled location (e.g. next to `--baseline`, or a new `--diff <png>`
   flag) before `cleanupWorkDir`, or omit `diffPngPath` from the emitted verdict.
   Document whatever you keep.

3. **Re-sync the README to the live tree.** Regenerate the quickstart/`--format
   tree` examples from an actual `node out/cli.js samples/hello-dali.preview.dali.cpp`
   run (6 nodes, two cameras, `name:""`, object-shaped `flexProps`), and either
   document or stop emitting `visible`/`opacity`. Decide whether label text should
   populate `name` (the README implies it should).

4. **Make the coverage gate real.** Configure c8 (`--src`/`--all` or a
   `.c8rc`/`nyc` include of the compiled sources with source maps) so the
   coverage summary reflects the tests, or drop c8 if a number isn't wanted —
   `All files | 0%` today is misleading.

5. **Add a self-hosted render-smoke CI job** (the yaml already sketches it in a
   comment): one `node out/cli.js samples/hello-dali.preview.dali.cpp --image
   /tmp/out.png` on a runner with the runtime image, so the actual code→PNG+tree
   path — the product's whole reason for existing — is covered by CI, not only by
   local runs.
