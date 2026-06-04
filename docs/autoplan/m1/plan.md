# M1 — execution plan (WU sequencing)

WU definitions + assertions: spec.md. Order (single-threaded, validate-before-next):
1. WU-1 — harness single-DFS rewrite: structural ids + screen-extents bounds + per-actor accessible role/name/states + type→role map + determinism  [F1.1/F1.2/F1.3/F1.4/F1.5, Tier 2]
2. WU-2 — TS canonical treeModel: project bounds{x,y,w,h}, carry id/role/sourceLine/semanticsSource; extract pure treeSchema.ts (structuralId, roleForType) as TS mirror  [F1.1, Tier 2 + unit]
3. WU-3 — cli.ts: make --image optional (bare invocation prints canonical tree)  [Inv-6, gates F1.x]
4. WU-4 — real unit-test suite (mocha+c8) under src/test/unit/ → npm test GREEN  [carry-over, Tier 3 Gate A]

Critical path WU-1→WU-2→WU-3; WU-4 after. No parallel impl. F1.4 determinism (two runs byte-identical) is the load-bearing gate.
