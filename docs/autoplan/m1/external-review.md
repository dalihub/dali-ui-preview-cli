# M1 external review — canonical tree schema (independent)

> Reviewer: independent (did NOT read architecture.md / adr/*). Opinion formed from
> the FROZEN feature-checklist + exec-validation claims + the code + my own
> read-only execution of the built CLI (`out/cli.js`) against the runtime docker image.

## Verdict: PASS

Every F1.1–F1.5 promise and all three user-requested input modes are demonstrable on
the bundled sample when I run the real CLI; determinism is byte-exact; the unit suite is
39 genuine assertions (no theatre); stdout is a pure JSON contract; and bad input fails
cleanly. The diff stays inside the M1 feature surface — no scope creep. The single
substantive soft spot (empty/whitespace input degrades into a runtime segfault diagnostic
rather than a clean "empty input" message) is correctness-safe and is documented behavior.

## Findings

### What I verified by running it (not just reading)
- **Three input modes + bare invocation — all PASS.** `node out/cli.js <sample>` (FILE),
  `cat <sample> | node out/cli.js` (STDIN), and `node out/cli.js --code "$(cat <sample>)"`
  (INLINE) each exit 0 and print a 1327-byte tree. The three outputs are **byte-identical**
  to each other (`diff -q` empty) — same code, same tree, regardless of how it arrived.
- **F1.4 determinism — PASS, byte-exact.** Two consecutive FILE runs produced
  byte-identical stdout (`diff -q` empty). Not "diffs to near-zero" — literally identical.
- **Stdout is a pure machine contract — PASS.** Output starts with `{` (0x7b) and ends with
  `}\n`; `JSON.parse` succeeds; grep for `OK:`/`CAPTURE`/`eldbus`/`Segmentation`/`error`
  finds nothing. All DALi/harness chatter and the eldbus noise go to stderr.
- **F1.1 schema — PASS.** Every node carries `id`/`type`/`role`/`name`/`bounds{x,y,w,h}`/
  `semanticsSource`. Concrete types are present and impl-accurate (`Layer`, `FlexLayoutImpl`,
  `LabelImpl`, `CameraActor` — never name-only). Roles come from the type→role map
  (`Layer→panel`, `FlexLayoutImpl→container`, `LabelImpl→label`, `CameraActor→camera`) — no
  `"unknown"` on the sample. `semanticsSource` is normalized `accessible→bridge` end-to-end.
- **F1.2 frame-accurate bounds — PASS.** The "Hello, Dali!" label reports `{381,262,262,56}`,
  horizontally centered (381 + 262/2 = 512 = width/2), consistent with the sample's
  FlexLayout CENTER/CENTER. Bounds derive from `CalculateCurrentScreenExtents`, and the root
  bounds `{0,0,1024,600}` exactly match the rendered PNG I captured via `--image`
  (`PNG 1024 x 600`).
- **F1.3 stable IDs — PASS, including the survives-an-edit guarantee.** IDs are the
  structural child-index path (`0`, `0/0`, `0/1`, `0/1/0`, `0/1/1`, `0/2`). I edited the
  first label's TEXT (`Hello, Dali!`→`Hello, EDITED!`); the edit took effect (its bounds
  width changed 262→348) yet **every id was unchanged** — so M4 tree-diff would report
  "changed", not remove+add. Real verification, not a coincidence.
- **F1.5 source-line provenance — PASS, and the mapping is correct, not lucky.** The sample's
  1-based lines 13/21/25 (`return FlexLayout::New()` / first `Label::New` / second
  `Label::New`) map to reported 0-based `sourceLine` 12/20/24. Critically the TWO labels get
  DISTINCT lines 20 vs 24 — a 4-line gap that matches the actual 4-line gap in the source, so
  the parser↔runtime walk is genuinely aligning, not stamping a constant. CameraActor
  siblings correctly receive NO `sourceLine`.
- **`--image` is optional and side-effect-only — PASS.** `--image /tmp/out.png` wrote a valid
  1024x600 RGBA PNG (20 KB) and left stdout **byte-identical** to the no-image run (Inv-6).
- **Robustness — PASS (fails cleanly).** Bad file path, unsupported extension, empty stdin,
  and malformed C++ each exit **1** with **zero bytes on stdout** (no partial/unparseable
  JSON leak) and a diagnostic on stderr.

### Test rigor (not theatre)
- `npm test` → **39 passing, 0 failing, exit 0** when I ran it. 39 `it()` blocks across 4
  files, **88 `expect()` assertions**. Grep for `expect(true)`/`expect(false)`/`.skip`/
  `.only`/empty `it()` bodies → **none**.
- The assertions check concrete values, not existence: `flex.sourceLine === 0`,
  `labels[0].sourceLine === 1`, `deep.equal(['bridge','bridge','bridge'])`,
  marker `startLine === 3`, gcc-line `12 - offset 10 → user line 2`. The sourceLine test even
  pins the camera-skip behavior. These are real behavioral assertions.
- File-mode tests use real temp files; stdin is exercised via a stubbed async-iterable. Good.

### Scope
- Diff across the 4 M1 commits touches ONLY: `server/preview_harness.cpp.template`,
  `src/treeModel.ts`, `src/cli.ts`, `src/inputResolver.ts`, the 4 new `src/test/unit/*`,
  `package.json` (adds a one-line `pretest` hook + the c8/mocha already present), and the
  `docs/autoplan/m1/*` bookkeeping. No unrelated extension files, no M2–M6 features. Clean.

## Could be stronger (even though PASS)
1. **Empty/whitespace input degrades into a misleading segfault diagnostic.** `printf '' |
   out/cli.js` exits 1 with empty stdout (contract honored), but only AFTER the empty-body
   harness compiles, runs, and **segfaults** — so the user sees an `eldbus`/`Segmentation
   fault`/`exited non-zero` wall, not "empty input". `inputResolver` intentionally defers this
   ("fails later at the harness/render stage"). A 2-line guard rejecting blank resolved
   `code` BEFORE rendering would turn a scary crash dump into one clear line. Correctness-safe
   today, but poor operator UX. (`src/inputResolver.ts:148`, `src/cli.ts:174`.)
2. **Coverage instrumentation is dead — c8 prints 0% (`0/0`).** The suite is real, but the
   reported number proves nothing and could mask future rot (a deleted test would not drop a
   visible metric). exec-validation flags it as cosmetic/M6, which is fair, but a `.c8rc.json`
   `include: ["out/**"]` is a ~3-line fix that would make the gate self-policing.
3. **F1.2 frame-accuracy is asserted only by my eyeball + PNG dimensions, never by a test.**
   The numeric bounds match the rendered frame and the centering math is self-consistent, but
   nothing in `npm test` (pure-function only) pins "bounds == rendered position". That gap is
   inherent to keeping the unit suite docker-free; a single tolerance-checked render fixture
   (or deferring to M4's image-diff) would close the only F1.x claim with no automated guard.

## Specific files to inspect
- `src/inputResolver.ts:148` — comment concedes empty/whitespace code "fails later at the
  harness/render stage"; that later stage is a runtime **segfault**, not a clean validation
  error. Best place (or `cli.ts:183` before `templateHarness`) for a blank-code guard.
- `src/treeModel.ts:86-108` — `mergeSourceLine`: the camera-skip + positional parser↔runtime
  walk that makes F1.5 work. I confirmed it produces the correct DISTINCT label lines (20/24);
  it never throws on count divergence (merges only what aligns). Load-bearing for F1.5.
- `src/treeModel.ts:185-196` — `findUserRoot`: anchors the parser tree to the first
  non-CameraActor child. Correct on the sample; would silently no-op (no sourceLine) if a
  future scene led with non-camera internal actors — worth a regression test in a later MS.
- `server/preview_harness.cpp.template:149-153, 244` — `CalculateCurrentScreenExtents` →
  rounded int bounds (F1.2) and the `accessible`/`reconstructed` provenance the TS layer later
  normalizes to `bridge`. The numbers I read back match the captured PNG.
- `src/cli.ts:189-201` — the unconditional tree-to-stdout then conditional `--image` copy;
  confirms stdout is identical with/without `--image` (Inv-6). Verified by byte-diff.
- `package.json` (scripts) — `pretest: npm run build` makes `npm test` a real Gate A; `c8`
  include config is the missing piece for non-zero coverage.
