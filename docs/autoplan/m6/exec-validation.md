# M6 — packaging + release — validated
- build 0 err; `npm test` 116 passing.
- F6.1 `--help` (3137 B): all flags + exit-code table + examples ✓
- F6.2 README.md (11 KB): npx install, worked example per feature, JSON node schema, exit codes, shared-container note ✓
- F6.3 package.json: files/engines(node>=18)/license(Apache-2.0)/keywords/repository/prepublishOnly; `npm pack` includes out/cli.js + server/preview_harness.cpp.template + README ✓
- F6.4 .github/workflows/ci.yml: npm ci + build + test + --version/--help smoke (docker render = self-hosted-only, documented) ✓
- F6.5 CHANGELOG: M1–M6 feature groups under Unreleased + the 0.1.0/M0 entry ✓
- FINAL end-to-end: `--resolution 800x480 --theme light --format tree` → box-tree at custom res; `--baseline golden` → verify match exit 0 ✓
- Verdict: PASS — CLI feature-complete + distributable.
