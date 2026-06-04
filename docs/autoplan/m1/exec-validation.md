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
