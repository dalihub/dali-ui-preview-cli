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
