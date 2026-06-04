# M1 — execution validation log

## WU-1 — Harness single-DFS rewrite [F1.1–F1.5 harness side; Tier 2 + determinism]
- **Build**: green (TS unchanged).
- **F1.4 DETERMINISM (load-bearing)**: 2 renders → tree JSON **byte-identical** (`diff -q` empty) ✓
- **Canonical fields** (run 1): root `{id:"0", type:"Layer", role:"panel", bounds{0,0,1024,600}}`; LabelImpl `{id:"0/1/0", role:"label", bounds{381,262,262,56}}`; FlexLayoutImpl `{id:"0/1", role:"container", flexProps:[direction,alignItems,justifyContent,wrap]}`.
- **F1.1** typed nodes + roles (LabelImpl→label, FlexLayoutImpl→container, Layer→panel via type→role map; not "unknown") ✓
- **F1.2** frame-accurate bounds via `CalculateCurrentScreenExtents` — Label "Hello, Dali!" {381,262,262,56} matches M0 DumpTree values ✓
- **F1.3** structural-path ids ("0", "0/1", "0/1/0"; `^[0-9]+(/[0-9]+)*$`) ✓
- **Latent bug FIXED**: flexProps now emitted (old harness check `=="FlexLayout"` never matched the real impl name `"FlexLayoutImpl"`).
- **Carry to WU-2**: normalize `semanticsSource` "accessible"→"bridge" (F1.1 accepts {dumptree,reconstructed,bridge}); merge `sourceLine` via cppParser; keep `bounds{}`.
- ✋: none (F1.2 optional vision hold unneeded — bounds numerically match)
- **Verdict: PASS (harness side; full F1.1/F1.2/F1.3 stdout gates run after WU-2 + WU-3 make `--image` optional)**

## WU-2 + WU-3 — canonical treeModel + input modes + --image optional [F1.1/F1.5, Inv-6, user req]
END-TO-END (real CLI, all input modes; build green):
- **FILE** bare `node out/cli.js <sample>` → tree JSON to stdout (1327 B, exit 0)
- **STDIN** `cat <sample> | node out/cli.js` → tree ✓
- **INLINE** `node out/cli.js --code "$(cat <sample>)"` → tree ✓
- **--image** `… <sample> --image x.png` → tree + non-empty PNG ✓
- Canonical fields (all 4 modes identical): root `{id:"0", type:"Layer"}`; 2× LabelImpl `role="label"`, `bounds{}`, `semanticsSource="bridge"` (normalized from "accessible"); **sourceLine=[20,24]** mapping the sample's label lines (F1.5 ✓)
- **file == stdin == inline** (byte-identical tree — same code) ✓
- **F1.4 determinism**: two file runs byte-identical ✓
- ✋: none
- **Verdict: PASS** (F1.1 schema, F1.2 bounds, F1.3 ids, F1.4 determinism, F1.5 sourceLine all green; input file|stdin|inline + optional image)

## WU-4 — Unit-test suite (mocha+c8) [carry-over; Gate A]
- `npm test` (pretest=`npm run build` → mocha): **39 passing**, 0 failing, exit 0.
  - treeModel: input validation (4), semanticsSource normalize "accessible"→"bridge" (F1.1), root-type stamping, sourceLine merge incl. camera-skip + startLine offset + graceful-no-source (F1.5).
  - inputResolver: preview-file/marker file modes, resolveFromCode inline+marker, resolveFromStdin (piped), error cases.
  - harnessTemplater: no leftover placeholders + paths embedded. errorParser (bonus).
- `npm test` is now a REAL Gate A (was vacuous — zero test files).
- Note (M6 polish): c8 coverage prints 0% — needs a `.c8rc.json` include config; cosmetic, tests pass.
- ✋: none
- **Verdict: PASS**

## M1 reviews + wrap-up
- **arch-review: DRIFT-MINOR** (mechanism substitutions, ADR-faithful → recorded in ADR-009; none block M2). **external-review: PASS** (reviewer ran the live CLI: all F1.1–F1.5 + 3 input modes demonstrable, byte-exact determinism, IDs survive an edit, pure-JSON stdout, clean failures; 39 genuine unit tests).
- **Review fix applied**: empty/blank input now rejected immediately (exit 1, "input is empty", no container spin-up) — addresses the external-review robustness note. Verified: real input unaffected, npm test still 39 passing.
- **Carry-over (later milestones)**: c8 coverage `.c8rc` config + automated F1.2 bounds assertion (M6 polish); friendlier compile-error message via structured errors (M5).
- **M1 termination signals (safety-rails §5)**: Gate A `npm test` 39 passing ✓; determinism byte-identical ✓; arch DRIFT-MINOR (recorded, non-blocking) ✓; external PASS ✓ → **M1 COMPLETE**.
