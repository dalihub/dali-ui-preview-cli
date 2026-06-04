# M1 Architecture Review — canonical tree schema

> Reviewer: architecture/drift auditor. Scope: DRIFT between the ADRs
> (`architecture.md` Inv-1..8 + ADR-003/004/008) and the M1 implementation.
> Snapshot: commits `55023bb` (WU-1 harness), `f5fab87` (WU-2 treeModel),
> `1047c6a` (WU-3 input modes + cli), `0d4fa7b` (WU-4 unit suite); ~974 insertions.
> Code read: `server/preview_harness.cpp.template`, `src/treeModel.ts`,
> `src/inputResolver.ts`, `src/cli.ts`, `src/test/unit/*.test.ts`.
> Gate A re-run live during this review: `npm test` → **39 passing, 0 failing**.

---

## Verdict: DRIFT-MINOR

The three ADRs that govern M1 (ADR-003 tree source, ADR-004 stable-id, ADR-008
DumpTree-headless) are **upheld in substance**, and every load-bearing invariant
(Inv-1, Inv-3, Inv-5, Inv-6) holds. The drift is confined to (a) **mechanism
substitutions** away from the WU spec's prescribed C++ implementation that still
satisfy the ADR they encode and pass the cited acceptance gates, and (b) **one
real deliverable omission** (`src/treeSchema.ts`, the tested TS mirror of the
Inv-1 id/role logic). None of these violate an ADR or invariant outright, so the
finding is MINOR (a note) — it does **not** block M2. The substitutions should be
recorded so the spec and ADR-008 are not later mis-read as describing the shipped
code, and the omission should be tracked because M2/M4 were told to reuse it.

---

## Drift findings

- **D1 (mechanism, not contract — ACCEPTABLE): semantic source uses per-actor
  `Accessibility::Accessible::Get(actor)` rather than the spec's `DumpTree(DUMP_FULL)`
  string-parse merge.** Spec WU-1 (`spec.md:110-118`) mandated: call
  `a->DumpTree(DUMP_FULL)` once at the root, parse the JSON into a parallel tree
  keyed by child-index order, and lift `role`/`states`/`text` per node. The
  implementation instead queries `Accessibility::Accessible::Get(actor)` **per
  node inside the DFS** and reads `GetRoleName()` / `GetName()`
  (`preview_harness.cpp.template:164,173,182`). Assessment: this honors the
  **substance** of ADR-008, whose actual empirical finding is "DALi builds its
  internal accessible tree **in-process**; D-Bus is only needed to *expose* it
  externally" (ADR-008:10) — both `DumpTree` and `Accessible::Get` read that same
  in-process tree headless. The per-actor approach is arguably cleaner (no
  in-harness JSON re-parser; no risk of leaking the per-run atspi `path:` counter
  the spec explicitly warned about at `spec.md:135`). WU-1 exec-validation records
  the resulting roles **numerically match** the M0 DumpTree spike
  (`exec-validation.md:7-8`). Drift = the ADR-008 *decision sentence* names
  `DumpTree`-the-method but the code uses a sibling API; the *finding* it rests on
  is exploited correctly. Record as an ADR-008 mechanism amendment.

- **D2 (vocabulary — ACCEPTABLE, and ADR-faithful): `semanticsSource` is emitted
  as `"accessible"` (C++) then normalized to `"bridge"` (TS), never `"dumptree"`.**
  Spec narrative (`spec.md:44,126`) said the value should be `"dumptree"` when
  enrichment ran. The harness emits `"accessible"`
  (`preview_harness.cpp.template:244,299`); `treeModel.normalizeSemanticsSource`
  maps `"accessible"→"bridge"` (`treeModel.ts:62-74`). Assessment: **not drift
  against the architecture** — `architecture.md:72` and Inv-2 use the
  `"bridge"|"reconstructed"` vocabulary, so `"bridge"` is *more* consistent with
  the canonical ADR text than the spec's later `"dumptree"`. The F1.1 acceptance
  gate was written to accept all three (`spec.md:306`:
  `ss==="dumptree"||ss==="reconstructed"||ss==="bridge"`), so the gate passes. Net:
  the spec's `"dumptree"` token is the outlier; the implementation matches the ADR.
  No action beyond noting the spec token is stale.

- **D3 (DELIVERABLE OMISSION — track, does not block): `src/treeSchema.ts` was
  not created; no `treeSchema.test.ts`.** Spec WU-2 (`spec.md:246-254`) and WU-4
  (`spec.md:440-446`) prescribed extracting `structuralId(parentPath, childIndex)`
  and `roleForType(type, dumpTreeRole?)` into a new pure module `src/treeSchema.ts`,
  unit-tested as a **TS mirror** of the C++ authority so Inv-1 logic is verifiable
  with no docker and a future TS-side reconstruction stays consistent. Neither the
  module nor its test file exists; the id-path and role-map logic live **only** in
  C++ (`RoleForType` at `preview_harness.cpp.template:127-137`; the path threading
  in `CollectActorMetadata`). Assessment: Inv-1 is **not** violated — there is still
  exactly one live id/role emitter (the harness), which is the invariant's actual
  requirement. What is lost is the spec's *defense-in-depth* (a no-docker unit test
  pinning the structural-id and role-map rules). M2 (marks) and a potential M4
  TS-side path were told these helpers would exist; they will have to add them.
  Record in `oos-queue.md` / carry into M2.

- **D4 (mechanism — ACCEPTABLE): `sourceLine` (F1.5) is produced entirely in TS
  via `cppParser`, not by parsing the `__L{line}` NAME tag in the harness.** Spec
  WU-1 (`spec.md:129-132`) said the harness should emit a numeric `sourceLine` by
  parsing the integer out of the `__L` NAME prefix. The harness emits **no**
  `sourceLine` (grep: 0 occurrences of `sourceLine`/`__L` in the template); instead
  `treeModel.mergeSourceLine` parses the user C++ with `cppParser` and injects the
  line by a parser↔runtime parallel walk, skipping `CameraActor` siblings
  (`treeModel.ts:86-109,164-173`). Assessment: F1.5 ("source line **where
  derivable**") is satisfied — WU-2/WU-3 end-to-end shows the two sample labels
  resolving to `sourceLine=[20,24]` (`exec-validation.md:21`), inside the F1.5
  gate's accepted range. ADR-004 only requires `sourceLine` be carried *alongside*
  the structural id as provenance (ADR-004:21), which it is. Mechanism differs from
  spec; contract met. Minor note.

- **D5 (cosmetic role-value divergence): root `Layer` role is `"panel"`, not the
  spec's `"window"`.** Spec WU-1 (`spec.md:122`) suggested `Layer → "window"` for
  the root and `"panel"` for nested layers; `RoleForType` maps **all** `Layer`
  → `"panel"` unconditionally (`preview_harness.cpp.template:131`). The F1.1 gate
  only requires the three load-bearing controls (Flex + 2 Labels) have a non-empty,
  non-`"unknown"` role (`spec.md:296`) — it does **not** assert the root's role
  string — so the gate passes. No invariant touches the specific role lexeme.
  Trivial; note only.

---

## Invariant audit (Inv-1..Inv-8)

- **Inv-1 (one source for ids ↔ marks): UPHELD (ids), marks DEFERRED to M2 by
  design.** Structural-path ids are assigned in the single C++ DFS
  (`CollectActorMetadata`, `preview_harness.cpp.template:210,253` building
  `idPrefix + "/" + i`; root `"0"` at `ExportSceneMetadata:292`). TS never
  re-derives an id — `treeModel`/`cli` pass the harness `id` through untouched.
  The overlay `mark` ordinal is correctly **not** emitted yet (M1 lands only the
  `id`; marks are M2 per `feature-checklist.md` "Out of scope" and `spec.md:58`).
  Caveat carried into D3: the prescribed TS *mirror* of this logic
  (`treeSchema.ts`) is absent, but the invariant (single live emitter) holds.

- **Inv-2 (tree-source independent of the a11y bridge): UPHELD.** The property
  walk is the unconditional base — `GetTypeName`/`GetCurrentProperty` +
  `CalculateCurrentScreenExtents` run for every node regardless of a11y
  (`preview_harness.cpp.template:145-159`). The accessible query is guarded by
  `hasA11y = (a11y != nullptr)` (`:165` analog at `:164`) and only *augments*
  role/name; when null, the property-walk role (`RoleForType`, else `"unknown"`)
  and the NAME-property name stand (`:168-185`), and `semanticsSource` records
  `"reconstructed"` (`:244`). A schema-valid tree is produced either way.

- **Inv-3 (byte-identical tree across runs): UPHELD — VERIFIED.** Children walk in
  `GetChildAt(0..n-1)` index order (`:250`); ids are structural paths, not
  pointers; no `GetId()`, no atspi `path:` counter, no timestamp is emitted;
  floats use a fixed locale-independent format (`json.imbue(std::locale::classic());
  json << std::fixed << std::setprecision(3)` at `ExportSceneMetadata:289-290`).
  WU-1 and WU-2/3 both record two consecutive renders as `diff -q`-empty
  (`exec-validation.md:6,23`).

- **Inv-4 (render in the fixed image, never the host): UPHELD (unchanged by M1).**
  The only render path remains `cli.ts → renderInContainer` (`dockerRunner`),
  `cli.ts:184`. M1 touched the harness template + TS formatting, not the
  in-container execution model; no native-DALi host link was introduced.

- **Inv-5 (faithful render = user's real C++ compiled): UPHELD.** The harness still
  compiles the verbatim user code via the `{{USER_CODE}}` slot inside
  `CreatePreviewUI()` (`preview_harness.cpp.template:40-43`); WU-3 feeds it
  `resolved.code` through `templateHarness` (`cli.ts:183`). No `SBBuildNode`-style
  reconstruction exists. `harnessTemplater.test.ts:21-24,41-47` pins verbatim
  insertion (including `$&`/`$1` literally). Adding stdin/inline input modes
  (D-scope below) does **not** weaken this — all three modes hand raw C++ to the
  same `{{USER_CODE}}` slot, and the end-to-end log confirms file == stdin ==
  inline byte-identical trees (`exec-validation.md:22`).

- **Inv-6 (JSON stdout primary; image on-demand): UPHELD.** WU-3 made `--image`
  optional: the `buildTree → process.stdout.write` path is unconditional
  (`cli.ts:189-193`) and the PNG copy is guarded by `if (parsed.imageOut !==
  undefined)` (`cli.ts:197-201`); when absent, the harness PNG stays in the temp
  workDir and is removed by `cleanupWorkDir` in `finally` (`cli.ts:208-210`).
  Stdout is reserved for JSON (+version/help); all diagnostics go to stderr via
  `console.error` (`cli.ts:176,205`). Bare-vs-`--image` stdout proven identical
  (`exec-validation.md:20`).

- **Inv-7 (config echoed = config used): N/A in M1 (deferred to M5).** Config flags
  (`--theme`/`--resolution`/`--dpr`) and the config-echo metadata block are M5
  (`feature-checklist.md` out-of-scope; `spec.md:61`). M1 bakes only the fixed M0
  1024×600 defaults; nothing to echo yet. Not violated — simply not in scope.

- **Inv-8 (id identity survives content/position edits): UPHELD by construction;
  full edit-diff exercise DEFERRED to M4.** Because the id is purely the structural
  path (`idPrefix + "/" + childIndex`), editing a label's text or color cannot
  change any id — the property values never feed the id. The M1 spec exercises this
  only as a *property* of the stable id (the F1.3 content-edit sub-check,
  `spec.md:407-409`), not as the M4 tree-diff feature. Construction guarantees it;
  the diff-level proof is correctly M4.

---

## Scope note (user-directed scope pull — RECORD, accepted)

The published plan deferred **stdin / inline `--code` input** to "later
milestones," but the **user explicitly requested file-or-code-block input now**, so
WU-3 pulled it into M1 (`cli.ts` `parseRenderArgs`/`resolveRenderInput`,
`inputResolver.resolveFromCode`/`resolveFromStdin`). Assessment: **ACCEPTABLE** as
user-directed scope. Rationale: (1) it is additive and does not touch any
invariant — all three modes converge on the same `{{USER_CODE}}` slot, preserving
Inv-5; (2) it is fully tested (`inputResolver.test.ts` covers preview-file, marker,
inline, and stubbed stdin); (3) the architecture's own module table already lists
`inputResolver` as resolving "file path | inline snippet | stdin"
(`architecture.md:32`), so the *capability* was always designed — only its
*milestone* moved earlier. This is a milestone re-timing, not a scope expansion
beyond M6. Recorded here so the plan/spec timing is reconciled; no ADR impact.

---

## Propagation impact

- **Affects M2 (Set-of-Mark marks + node↔image-region):** POSITIVE — the WU-1
  structural ids are exactly the identity M2's `mark` ordinals and coord→node /
  node→region lookups key on (ADR-004 / Inv-1); M2 adds the `mark` ordinal in the
  *same* DFS that already emits these ids, so Inv-1 stays a one-emitter guarantee.
  CAVEAT from **D3**: M2 was told the id/role helpers would already exist as a
  tested pure module (`src/treeSchema.ts`); they do not, so M2 must either add that
  module or continue treating the C++ harness as the sole id authority. Also from
  **D5**: if M2's overlay legend wants the root labelled "window," it must add that
  mapping (currently "panel").

- **Affects M4 (tree-diff on ids + determinism):** POSITIVE and load-bearing — the
  custom id-keyed tree-diff (ADR-005) depends on exactly the two properties M1
  delivered and verified: stable structural-path ids (Inv-8, so edits report
  "changed" not remove+add) and byte-identical determinism (Inv-3, so no phantom
  diffs). Both are upheld. No blocker. If M4 grows a TS-side tree builder it
  inherits D3 (no shared `roleForType`/`structuralId` to reuse).

- **Affects M5 (config-echo + structured errors + eldbus stderr filter):**
  NEUTRAL/WATCH — Inv-7 config-echo is cleanly deferred (no premature coupling in
  M1). **Carry-forward from ADR-008 + D1:** because the harness now touches the
  accessibility subsystem per node (`Accessible::Get`), the headless D-Bus/eldbus
  stderr deluge ADR-008 warned about (ADR-008:20,26) is still live and **must** be
  filtered by M5 so it never pollutes the structured-error contract. M1 correctly
  did not filter it (out of scope per `feature-checklist.md:26`); M5 owns it.

- **Affects M6 (packaging):** NEUTRAL — no packaging surface touched in M1. D3's
  missing module is internal and does not affect the `npx` artifact.

---

### Bottom line

PASS-with-notes. Ship M1 / proceed to M2. No DRIFT-MAJOR (nothing blocks the next
milestone). Four MINOR mechanism/vocabulary divergences (D1, D2, D4, D5) are
ADR-substance-preserving and pass the cited gates; D2 actually realigns the
implementation with the canonical `"bridge"` vocabulary over the spec's stale
`"dumptree"` token. The one item worth tracking is **D3** — the spec-prescribed
`src/treeSchema.ts` tested mirror of the Inv-1 id/role logic was not built; this is
a defense-in-depth omission (the single live emitter, hence Inv-1, is intact) that
M2 should pick up. Recommend: (1) add a one-line amendment to ADR-008 noting the
shipped semantic source is per-actor `Accessible::Get`, not `DumpTree`-the-string;
(2) log D3 in `oos-queue.md` for M2; (3) treat the user-directed stdin/inline pull
as an accepted milestone re-timing.
