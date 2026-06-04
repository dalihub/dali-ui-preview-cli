# M0 — External (independent) review

> Reviewer: independent agent. Brief: fresh opinion on USER-VISIBLE behavior + TEST RIGOR.
> Deliberately did NOT read architecture.md / adr/* (avoid echo chamber). Read code,
> feature-checklist, exec-validation, spec, the spike artifact, and the golden PNG (visually).

---
## Verdict: PASS

The five frozen features F0.1–F0.5 are each demonstrable from the code + artifacts, and the
two non-mechanical claims (the render *looks right*; DumpTree *works headless*) are backed by
real, independently-verifiable artifacts — not asserted blind. I re-read the golden PNG myself
and it genuinely shows F0.3's promise (dark navy `0x1e1e2e` bg, column-centered large white
"Hello, Dali!", smaller gray "Edit this file to see the preview update" subtitle, no
corruption). The spike `.txt` contains a real captured DumpTree payload that matches the
rendered scene, so F0.5's "yes" is evidence-backed, not theatre. No scope creep: the tracked
file set is exactly the M0 snapshot (+ `package-lock.json`, which has its own justified commit).

It is a PASS, but with rigor gaps worth recording (below) — chiefly that the *committed* test
surface is zero and the F0.4 assertion is weaker than the artifact it guards.

## Findings

### Could-be-stronger (no rubber-stamp; these are the load-bearing weaknesses)

- **F0.4 assertion proves only 2 levels, not the ≥2-deep nesting it claims.** The harness
  genuinely recurses (`server/preview_harness.cpp.template:196-205` `CollectActorMetadata`
  emits a nested `children` array per actor), and the real tree IS 3 levels deep
  (RootLayer → FlexLayoutImpl → 2×LabelImpl, confirmed in `spike-dumptree-output.txt:38`).
  BUT the graded assertion (`docs/autoplan/m0/spec.md:186-199`) only checks `root.type`,
  `root.children.length >= 1`, and `root.children[0].type`. A degenerate
  `{type:"Layer", children:[{type:"CameraActor"}]}` (root + one flat leaf, NO grandchildren)
  would PASS — yet exec-validation/WU-5 and the feature-checklist describe "≥2 levels" /
  per-node nesting. The assertion under-verifies the FlexLayout→Label depth that the feature
  actually delivers. Recommend asserting a grandchild type (or asserting `child[0]` itself has
  a non-empty `children`) so the test matches the promise.

- **F0.3's mechanical check (PNG magic + >100 bytes) cannot detect a blank/garbage render.**
  `spec.md:159` guards against an error-text-file-masquerading-as-PNG (good — verified the
  8-byte signature gate), but a valid PNG of solid navy with no text would also pass. The ONLY
  thing standing between "wired" and "actually rendered the UI" is the ✋ human/vision judge.
  I discharged that judge independently by reading `tests/golden/hello-dali.png` and it is
  correct — so F0.3 holds — but the PASS rests on the vision hold, not the automated gate. If
  the project later drops the ✋ and relies on magic-bytes alone, a black-frame regression would
  pass silently. (This is the intended M0 posture per the spec, just flagging the dependency.)

- **Zero committed executable tests; `test:unit` matches nothing.** Every F0.1–F0.5 assertion
  lives only in `spec.md` / `test-plan.md` as ad-hoc shell snippets the orchestrator ran once;
  none are committed as runnable test files. `git ls-files` shows no `*.test.*`/`*.spec.*`
  source, and `npm run test:unit` globs `out/test/unit/**/*.test.js`, which resolves to 0 files
  (`out/test/unit` does not exist). So `npm test` is vacuous today — there is no committed
  regression net for M0; re-validation requires re-running the docs by hand. Acceptable for an
  infra milestone (the spec explicitly defers unit tests to M1), but it means the green ticks in
  `exec-validation.md` are not reproducible via the package's own test command.

### Neutral / confirmed-sound (checked, no defect)

- **Scope is clean — no creep.** Tracked non-doc files match the M0 list exactly; the only
  addition is `package-lock.json` (commit `3fb93d4`, "track package-lock.json (reproducible
  installs)") — a defensible reproducibility add, not feature creep. No stray edits to other
  source files.

- **`docs/agent-enablement.md` is the original vision note, NOT an agent rewrite.** It was
  committed in `02877c5` ("docs: agent-enablement vision note") BEFORE any WU work began, and
  reads as a coherent 3-stage Korean strategy summary (knowledge → render-loop → tooling) with
  no autoplan/WU/ADR scaffolding leaking in. The reported revert is consistent with the current
  state — confirmed original.

- **Silent-failure paths are guarded (loud-fail), with one nuance.** `dockerRunner.ts:225-234`
  fails hard on non-zero exit OR missing `OK:` marker; `:239-243` fails if the PNG is absent
  despite an OK. `treeModel.buildTree` throws on null/empty/invalid JSON or a non-object root
  (`treeModel.ts:40-61`). Nuance: `dockerRunner.ts:247-252` swallows a tree.json read error to
  `null` (best-effort), but the CLI then calls `buildTree(null)` which throws → exit 1, so a
  PNG-without-tree run cannot silently "succeed" on F0.4. Good.

- **The ANSI-strip fix is real, not a fudge.** `dockerRunner.ts:223` strips escape sequences
  before the start-of-line `OK:` regex; exec-validation WU-4 documents this root-cause (DALi's
  colored stdout prefixes the marker with a reset seq). This is a legitimate robustness fix, and
  it does not loosen the success contract (exit-0 is still required alongside the marker).

- **F0.5 conclusion is artifact-supported, not asserted blind.** The spike `.txt` shows BOTH
  the D-Bus/AT-SPI bridge genuinely down headless (`spike-dumptree-output.txt:24-28`, real
  eldbus socket error) AND a 1156-char DumpTree payload whose structure/bounds match the
  rendered scene (`:38`). The "DumpTree works headless WITHOUT D-Bus" verdict is therefore
  empirically grounded; the caveat that roles are mostly "unknown" is honestly recorded.

## Specific files to inspect

- `docs/autoplan/m0/spec.md:186-199` — F0.4 stdout assertion: only verifies root + child[0]
  type, so it under-checks the real ≥2-deep nesting; a flat root+leaf tree would pass.
- `docs/autoplan/m0/spec.md:159` & `:162` — F0.3 PNG check is magic-bytes only; blank/garbage
  frames are caught solely by the ✋ vision judge, not the automated gate.
- `package.json:13-14` — `test:unit` globs `out/test/unit/**/*.test.js`; no such files/dir exist,
  so `npm test` currently asserts nothing (no committed regression net for M0).
- `src/treeModel.ts:67-69` — unconditional `root.type='Layer'` stamp; correct here, but note it
  fabricates a type the harness never emitted, so the stdout root type is CLI-synthesized, not
  rendered evidence (the child types ARE rendered evidence — that distinction is what makes the
  F0.4 *child*-type check the meaningful one).
- `src/dockerRunner.ts:247-252` — best-effort tree.json read returns null on failure; verified
  the CLI still hard-fails downstream via `buildTree(null)`, so no silent F0.4 pass.
- `tests/golden/hello-dali.png` — independently read; matches F0.3's described UI exactly.
- `docs/autoplan/m0/spike-dumptree-output.txt:24-38` — both the live bridge-down error and the
  real DumpTree payload that back F0.5's "yes" verdict.
