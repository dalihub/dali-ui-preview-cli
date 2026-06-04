# M5 — Config flags + structured errors + exit codes — spec (+ tests)
Goal: render config (--resolution/--theme/--dpr) actually changes the render and is echoed in output metadata; compile/render failures surface as a structured {phase,message,sourceLine} (reuse vendored errorParser); distinct documented exit codes per failure phase.
Out of scope: packaging/README/CI (M6).

## WU-1 — Render config flags  [F5.1, Tier2]
- Files: src/cli.ts (parse `--resolution WxH`, `--theme dark|light`, `--dpr N`), src/harnessTemplater.ts (already takes width/height/backgroundColor — add theme→bg + dpr scaling), src/dockerRunner.ts (pass PREVIEW_WIDTH/HEIGHT = w*dpr × h*dpr).
- --resolution WxH → render at that size (default 1024x600). --theme dark→ dark bg (current default), light→ a light bg color. --dpr N (default 1) → render dimensions multiplied by N (device pixels).
- Assertion: `--resolution 800x480` → root bounds w≈800 h≈480 (the Layer fills the window); `--theme light` → a different background pixel than dark (check the rendered PNG corner pixel differs from the dark default); `--dpr 2 --resolution 400x300` → root bounds ≈ 800x600.

## WU-2 — Config echo in metadata  [F5.2, Tier2]
- Files: src/cli.ts / src/treeModel.ts — attach a `meta` object to the ROOT node: `{ resolution:{w,h}, theme, dpr }` echoing the EFFECTIVE values used.
- Assertion: stdout JSON `root.meta` equals the flags passed (e.g. `--resolution 800x480 --theme light --dpr 1` → `root.meta={resolution:{w:800,h:480},theme:"light",dpr:1}`); defaults echoed when omitted.

## WU-3 — Structured errors  [F5.3, Tier2]
- Files: src/dockerRunner.ts (on container failure, attach raw stderr + exitCode to the thrown error, e.g. a `RenderError` with `.stderr`/`.phase`), src/cli.ts (catch → run errorParser.parseGccErrors with the harness offset from harnessTemplater, build `{phase:"compile"|"render", message, sourceLine}` mapped back to the USER's source line, print it as JSON to STDERR).
- harnessTemplater: expose the {{USER_CODE}} line offset (getHarnessCodeOffset on the filled template) so sourceLine = gccLine - offset + resolved.startLine.
- Assertion: feed deliberately broken code (`--code "return Banana::Nope();"`) → stderr contains a JSON `{"phase":"compile","message":...,"sourceLine":...}`; stdout empty; nonzero exit.

## WU-4 — Distinct exit codes  [F5.4, Tier2]
- Files: src/cli.ts — documented codes: 0 ok, 1 usage/empty-input, 10 compile error, 11 render/capture error, 12 docker-unavailable, 20 diff-mismatch (M4). Listed in `--help`/USAGE.
- Assertion: usage error → 1; broken code → 10; (docker down is hard to force — document only); diff-mismatch → 20 (already). A script can tell why from `$?`.

## WU-5 — Unit tests: harnessTemplater theme/dpr/resolution substitution; the structured-error mapping (parseGccErrors offset math) given a synthetic g++ stderr; meta echo. npm test GREEN.

Dependency: WU-1→WU-2 (meta echoes WU-1 values); WU-3→WU-4 (codes); WU-5 last.
## Self-Review: none placeholder; reuses errorParser (vendored M0) + harnessTemplater opts; scope F5.x; exit codes distinct (10/11/12 vs 1/20).
