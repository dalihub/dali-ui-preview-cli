# M2 — execution validation (real CLI + vision)
- build exit 0 (0 TS errors); `npm test` **60 passing** (was 39; +21 M2 unit tests: mark assignment, treeQuery lookups, overlay renderer).
- **F2.1 overlay** `--overlay out.png` → annotated PNG. ✋ VISION CONFIRMED: magenta boxes + mark numbers around FlexLayout(#3), "Hello, Dali!"(#4), subtitle(#5); cameras (#2/#6 zero-area, #1 Layer canvas border) handled. → NO_GOLDEN_BUT_LOOKS_RIGHT.
- **F2.2 parity**: marks co-assigned with ids in the one treeModel DFS — Layer#1, CameraActor#2, FlexLayoutImpl#3, LabelImpl#4, LabelImpl#5, CameraActor#6; overlay + `--at` + `--node` + stdout all read one tree (Inv-1).
- **F2.3** `--at 500,290` → `{id:"0/1/0", mark:4, type:"LabelImpl", role:"label", bounds{381,262,262,56}}` (smallest containing box) ✓
- **F2.4** `--node 0/1/0` → same region ✓
- Fix during validation: 1 TS type error in treeQuery.test.ts (NodeRegion cast → `.to.not.have.property`).
- **Verdict: PASS** (✋ overlay vision hold).
