# M4 — verify loop — validated by real execution
- build 0 err; `npm test` **95 passing** (+13 M4 tests). pixelmatch@7 is pure-ESM → loaded via dynamic `import()` (runtime-verified working).
- F4.1 `--baseline tests/golden/hello-dali.png` → ratio 0, pass true (self-match) ✓
- F4.3 verdict+exit: self → exit 0 `match:true`; diverge (`--threshold 0.001`, 0.76%>0.1%) → **exit 20** `match:false` ✓
- F4.2 `--baseline-tree`: self → no diff (a0 r0 c0); a changed-bounds target → `changed=[{id:"0/1/0", fields:["bounds"]}]`, exit 20 ✓
- F4.4 `--update-baseline --baseline b.png` → writes render PNG; subsequent `--baseline b.png` → match exit 0 ✓
- **Verdict: PASS** — the agent write→render→verify→exit-code loop works end-to-end.
