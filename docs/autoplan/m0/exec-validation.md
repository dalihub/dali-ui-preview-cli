# M0 — execution validation log

> Gate A = static/build (tsc). Gate B = the test-plan assertion (run fresh by the orchestrator).

## WU-1 — Project skeleton + build + `--version`  [F0.1, Tier 3]
- **Gate A**: `npm install` (139 pkgs, ~9s) + `npm run build` (`tsc -p ./`, 0 errors) → PASS
- **Gate B (F0.1, verbatim)**: `out/cli.js` exists; `node out/cli.js --version` → `0.1.0` (matches `^[0-9]+\.[0-9]+\.[0-9]+`) → PASS
- Bonus: `--help` / no-args → one-line usage to stdout, exit 0; unknown args → stderr + exit 1
- **Ratified deviation**: tsconfig `rootDir: "src"` (not `"."`) so tsc emits `out/cli.js` (the graded path), matching `bin`/`main`. The spec's `rootDir:"."` + `src/cli.ts` would emit `out/src/cli.js` and FAIL `test -f out/cli.js`. Forward note: future unit tests live under `src/test/unit/` → compile to `out/test/unit/` (satisfies the `test:unit` script). Applied in M1.
- ✋: none
- **Verdict: PASS (Tier 3)**

## WU-2 — Vendor paperclip infra + canonical sample fixture  [F0.2, Tier 3]
- **Gate A**: `npm run build` — vendored `cppParser`/`flexMetadata`/`errorParser` all compile under strict tsc (0 errors) → PASS
- **Gate B (F0.2, verbatim)**: sample exists + non-empty, contains `Hello, Dali!` + `FlexLayout::New`, git-tracked (staged) → PASS
- Vendored: `samples/hello-dali.preview.dali.cpp`, `server/preview_harness.cpp.template`, `src/cppParser.ts`, `src/flexMetadata.ts`, `src/errorParser.ts` (vscode-STRIPPED: dropped `import vscode` + `errorsToDiagnostics`; kept parse/offset/format + `ParsedError`). Provenance headers added (ADR-007).
- ✋: none
- **Verdict: PASS (Tier 3)**

## WU-3 — Input resolver + harness templater  [enables F0.3/F0.4, Tier 3 build smoke]
- **Gate A**: `npm run build` (0 errors) → PASS
- **Functional (WU-3 acceptance, stronger than build-only)**: `resolveInput(sample)` → preview-file mode, startLine 0, code has 'Hello, Dali!'; `templateHarness(code)` → 11703-char C++ with ZERO `{{...}}` placeholders, embedding user code + `/work/preview.png` + `/work/tree.json` + `1024`/`600` → PASS
- ✋: none
- **Verdict: PASS (Tier 3 + functional placeholder check)**

## WU-4 — Container render path → PNG  [F0.3, Tier 2 + §G vision ✋]
- **Gate A**: `npm run build` (0 errors) → PASS
- **Gate B (F0.3, verbatim)**: `node out/cli.js samples/hello-dali.preview.dali.cpp --image /tmp/...png` → exit 0, non-empty PNG, valid PNG magic bytes (20147 B) → PASS
- **✋ Vision judge (§G ③)**: orchestrator Read the PNG → **NO_GOLDEN_BUT_LOOKS_RIGHT** (dark bg + centered white "Hello, Dali!" + gray subtitle, no corruption). Auto-baseline → `tests/golden/hello-dali.png`; queued in `visual-holds.md`.
- **Retry**: 1 within WU-4 (budget 3) — first render reported "no OK: marker"; root cause: DALi's ANSI-colored stdout prefixes the harness `OK:` line with a reset seq, defeating the start-of-line regex. Fix: strip ANSI in `dockerRunner` before marker detection. Re-render → PASS.
- **Bonus (F0.5 spike evidence)**: container output confirms D-Bus/AT-SPI is DOWN headless ("cannot get dbus connection", "Accessibility Status DbusClient is not ready"); render proceeds fine with accessibility disabled.
- **Verdict: PASS (Tier 2 + vision ✋)**
