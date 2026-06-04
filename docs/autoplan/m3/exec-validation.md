# M3 — dual output — validated by real execution
- build 0 err; `npm test` **82 passing** (+22 M3 tests).
- F3.1 `--format tree`: box-drawing (┠╴/┖╴/┃) hierarchy `Type "name" #mark [id] (WxH @ x,y)` ✓
- F3.2 `--report r.html` (28 KB, base64 `<img>` + box-tree + node table) / `r.md` ✓
- F3.3 `--max-depth 1` → depth 1, 4 nodes, `truncated` marker; `--max-nodes 3` → 3 nodes ✓
- F3.4 `--watch`: re-renders on file change (2 tree emissions via mtime touch); `--watch` + non-file input → clear error, exit 1 ✓
- Verdict: PASS
