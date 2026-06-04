# M0 → M1 carry-over (from external-review "could be stronger" + arch-review propagation)

Non-blocking improvements deferred from M0 (verdicts were PASS); fold into M1:

1. **Real unit tests** — M0 has a `test:unit` script but ZERO committed test files, so `npm test` is vacuous (and `mocha out/test/unit/**/*.test.js` errors on no-match). M1 must add unit tests under `src/test/unit/` (→ `out/test/unit/`) for the pure modules: `treeModel`, `harnessTemplater`, `inputResolver` (+ the M1 schema/id logic). Ensure `npm test` runs green (so it can be a real Gate A in M1+).
2. **Stronger tree assertion** — F0.4's check only verifies root+1 level of nesting/type. M1's canonical-schema test should assert the FULL expected node set (FlexLayout→2 Labels), concrete types, and bounds.
3. **Blank-frame detection** — F0.3 relies on the human vision judge to catch a blank/garbage render (magic-bytes only proves "a PNG exists"). M1/M4 pixel-diff vs `tests/golden/hello-dali.png` closes this.
4. **Inv-6 image-on-demand** (arch-review note) — `--image` is mandatory in M0; once M3 adds a bare/`tree` command, make PNG production flag-gated so a bare invocation emits only stdout JSON.
5. **Spike upgrade for M1 tree schema** (ADR-008) — merge DumpTree (role/states/text/type/bounds) with the property-walk (colors/flex) + add a control-type→role map (DumpTree roles default to "unknown"); record `semanticsSource`. Property-walk stays the Inv-2 floor.
6. **Filter eldbus/D-Bus stderr deluge** (M5) — the headless render emits a loud eldbus backtrace storm on stderr; M5's structured-error path must filter it.
