# M4 — Verify loop (image-diff + tree-diff + verdict) — spec (+ tests)
Goal: compare a render against a target (image + tree) so an agent can branch on "did my change reach the goal?". Uses pixelmatch+pngjs (deps present) + id-keyed tree-diff (M1 stable ids). All TypeScript.
Out of scope: config flags --theme/--resolution/--dpr + structured errors (M5); packaging (M6).

## WU-1 — Image diff vs baseline  [F4.1, Tier2+unit]
- src/diff/imageDiff.ts: `imageDiff(actualPngPath, baselinePngPath, opts?{threshold=0.1, failRatio=0.01}): {dimsMatch, diffPixels, totalPixels, ratio, pass, diffPngPath?}` via pixelmatch+pngjs; if dims differ → dimsMatch:false, pass:false; else write `<actual>.diff.png` and pass = ratio <= failRatio.
- cli: `--baseline <png>` → render, diff actual vs baseline, print `{image:{diffPixels,ratio,pass,dimsMatch}}` (or fold into verdict, WU-3).
- Assertion: `--baseline tests/golden/hello-dali.png` on the sample → ratio ~0, pass true (self-match). A blank/different baseline → pass false.

## WU-2 — Tree diff vs target  [F4.2, Tier2+unit]
- src/diff/treeDiff.ts: `treeDiff(current, target): {added:[{id,type}], removed:[{id,type}], changed:[{id, fields:[]}]}` — index both trees by id (treeQuery.forEachNode), added = in current not target, removed = in target not current, changed = same id with differing type/role/bounds/name/sourceLine.
- cli: `--baseline-tree <json>` → diff current vs the target tree JSON.
- Assertion: diff a tree against itself → all-empty; against a target with one node's bounds changed → changed reports that id.

## WU-3 — Combined verdict + exit codes  [F4.3, Tier2]
- src/diff/verdict.ts: `verdict({image?, tree?}): {match:boolean, image?, tree?}` — match = (no --baseline OR image.pass) AND (no --baseline-tree OR tree has no added/removed/changed). cli exit code: 0 = match, 20 = diverged (image or tree differs). Print the verdict JSON to stdout.
- Assertion: self image+tree baseline → exit 0, `"match":true`; a different baseline → exit 20, `"match":false`.

## WU-4 — Baseline capture/update  [F4.4, Tier2]
- cli: `--update-baseline` (requires `--baseline <png>`; optional `--baseline-tree <json>`) → write the current render PNG to the baseline path (+ current tree JSON to baseline-tree) and exit 0 (no diff).
- Assertion: `--update-baseline --baseline /tmp/b.png` writes the render; then `--baseline /tmp/b.png` → match (exit 0).

## WU-5 — Unit tests: imageDiff (synthetic in-memory PNGs identical→pass, differing→fail, dim-mismatch), treeDiff (self→empty, changed-bounds→changed, add/remove). npm test GREEN.

Dependency: WU-1,WU-2 independent; WU-3 needs both; WU-4 independent; WU-5 last.
## Self-Review: none placeholder; reuses pixelmatch/pngjs + id tree; scope = F4.x only; exit-code 20 chosen for diverge (distinct from 0/1).
