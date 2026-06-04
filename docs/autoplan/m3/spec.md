# M3 — Dual output (human + AI surfaces) — spec (+ embedded tests)

Goal: from one render, offer human surfaces (box-drawing tree, HTML/MD report) and AI surfaces (token-bounded JSON via --max-depth/--max-nodes), plus a watch mode. All TypeScript; the canonical tree (id/type/role/bounds/mark/sourceLine) already exists.
Out of scope: image-diff/tree-diff/verdict (M4); config flags --theme/--resolution/--dpr + structured errors (M5); packaging (M6).

## WU-1 — Box-drawing tree formatter  [F3.1, Tier2+unit]
- Files: src/formatters/treeFormatter.ts (new), src/cli.ts (add `--format tree|json`, default json).
- `formatTree(root)`: indented box-drawing (`┖╴`/`┠╴`/`┃`/`└─`) hierarchy, one line/node: `Type "name" #mark  [id]  (WxH @ x,y)`. Human-readable.
- Assertion: `node out/cli.js <sample> --format tree` stdout contains a box-drawing char AND `LabelImpl` AND `#4`; `--format json` (or default) still prints JSON.

## WU-2 — HTML/MD report  [F3.2, Tier2]
- Files: src/formatters/reportFormatter.ts (new), src/cli.ts (add `--report <file>`; .html or .md by extension).
- `--report out.html` renders the rendered PNG (embed as base64 data-URI) + the box-tree + a small node table; `--report out.md` = markdown with the tree + image link. Self-contained single file. Implies render.
- Assertion: `--report /tmp/r.html` → file exists, non-empty, contains `Hello` (or `LabelImpl`) and `<img` (html) ; `--report /tmp/r.md` contains the tree + `Hello`.

## WU-3 — Token-bounded JSON  [F3.3, Tier2+unit]
- Files: src/treeTruncate.ts (new, pure), src/cli.ts (add `--max-depth N`, `--max-nodes N`).
- `truncate(root, {maxDepth?, maxNodes?})`: prune beyond depth / beyond a node budget (pre-order), marking pruned parents with `"truncated": true` (and dropping their children); deterministic. Applied to the stdout JSON only.
- Assertion: `--max-depth 1` → JSON depth ≤1 below root (root + its direct children, grandchildren dropped, some node has truncated:true) and byte length < the full tree; `--max-nodes 3` → total emitted nodes ≤ 3.

## WU-4 — Watch mode  [F3.4, Tier3 smoke]
- Files: src/watch.ts (new), src/cli.ts (add `--watch`, requires a FILE input).
- `--watch`: render once + print tree, then fs.watch the input file; on change (debounced ~150ms) re-render + re-print (each emission a single JSON line / a clear separator). Runs until SIGINT/SIGTERM.
- Assertion (smoke): start `node out/cli.js <sample> --watch` in background; it prints an initial tree within ~timeout; `touch` the sample → a second tree emission appears; kill it. (If flaky in CI, downgrade to: --watch with a non-file input errors clearly + exit 1.)

## WU-5 — Unit tests  [Gate A]
- src/test/unit/{treeFormatter,treeTruncate}.test.ts (+ reportFormatter if pure-extractable). npm test stays GREEN.

Dependency: WU-1→WU-2 (report reuses the box-tree); WU-3, WU-4 independent of WU-1/2; WU-5 last.

## Self-Review
- Placeholder: none. Consistency: reuses existing canonical tree (mark/id/bounds). Scope: only F3.x; no diff/config. Ambiguity: report embeds PNG as base64 (self-contained) — resolved.
