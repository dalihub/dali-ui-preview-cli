# M0 — execution validation log

> Gate A = static/build (tsc). Gate B = the test-plan assertion (run fresh by the orchestrator).

## WU-1 — Project skeleton + build + `--version`  [F0.1, Tier 3]
- **Gate A**: `npm install` (139 pkgs, ~9s) + `npm run build` (`tsc -p ./`, 0 errors) → PASS
- **Gate B (F0.1, verbatim)**: `out/cli.js` exists; `node out/cli.js --version` → `0.1.0` (matches `^[0-9]+\.[0-9]+\.[0-9]+`) → PASS
- Bonus: `--help` / no-args → one-line usage to stdout, exit 0; unknown args → stderr + exit 1
- **Ratified deviation**: tsconfig `rootDir: "src"` (not `"."`) so tsc emits `out/cli.js` (the graded path), matching `bin`/`main`. The spec's `rootDir:"."` + `src/cli.ts` would emit `out/src/cli.js` and FAIL `test -f out/cli.js`. Forward note: future unit tests live under `src/test/unit/` → compile to `out/test/unit/` (satisfies the `test:unit` script). Applied in M1.
- ✋: none
- **Verdict: PASS (Tier 3)**
