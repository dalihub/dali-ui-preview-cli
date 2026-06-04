# Changelog

## Unreleased

### Canonical scene tree (M1)

- Every node carries `id` (structural path like `0/1/0`), `mark` (1-based ordinal),
  `type`, `role` (type→role map), frame-accurate `bounds{x,y,w,h}`
  (`CalculateCurrentScreenExtents`), `name`, `semanticsSource` (`bridge`|`reconstructed`),
  `sourceLine`, `properties`, optional `flexProps`, and `children`.
- Deterministic output: two renders of the same input are byte-identical.
- Input modes: a file path, a `-`/piped **STDIN** code block, or inline `--code "<text>"`.
- `--image` is now optional — a bare invocation prints the tree JSON to stdout.
- Empty input is rejected immediately (clear error, no container spin-up).

### Image ↔ tree mapping (M2)

- `--overlay <png>` writes a Set-of-Mark annotated PNG (numbered magenta boxes per node).
- `--at X,Y` prints the topmost (smallest-area) node at a pixel; `--node <id>` prints a
  node's region. Both emit a flat `{id, mark, type, role, bounds}` JSON.
- Marks and ids are co-assigned in one tree walk, so the overlay number and the JSON `mark`
  can never drift.

### Dual output: human + report + token caps + watch (M3)

- `--format tree` prints a box-drawing hierarchy (`Type "name" #mark [id] (WxH @ x,y)`)
  instead of JSON.
- `--report <file.html|.md>` writes a self-contained report (embedded PNG + box-tree +
  node table); the JSON tree is still printed to stdout.
- `--max-depth N` / `--max-nodes N` bound the stdout JSON for token-limited callers
  (a `truncated` marker shows where pruning happened).
- `--watch` re-renders on file change (FILE input only).

### Verify loop: image + tree diff (M4)

- `--baseline <png>` image-diffs the render (pixel ratio + pass/fail); `--baseline-tree <json>`
  id-keyed tree-diffs it (added / removed / changed nodes).
- stdout becomes a single `{match, image?, tree?}` verdict; exit 0 on match, 20 on divergence
  (distinct from a tool error).
- `--threshold <ratio>` sets the image-diff fail ratio; `--update-baseline` writes the current
  render as the new baseline(s).

### Config + structured errors + exit codes (M5)

- `--resolution WxH` (default 1024x600), `--theme dark|light` (default dark), `--dpr N`
  (default 1) control the render; the effective config is echoed as `root.meta`.
- Compile/render failures print a structured `{phase, message, sourceLine}` JSON to stderr;
  stdout stays empty.
- Distinct exit codes: 0 ok, 1 usage/empty input, 10 compile error, 11 render error,
  12 docker unavailable, 20 verify diff mismatch.

### Packaging + release readiness (M6)

- Complete `--help`/`--version` reference (all flags + exit-code table + examples).
- `README.md` with quickstart, worked examples per feature, the JSON node schema, and an
  AI-agent usage note.
- npm-distributable (`files`/`engines`/`license`/`keywords`/`repository`/`prepublishOnly`)
  and a CI workflow (build + test + CLI smoke; the Docker render path runs on a self-hosted
  runner only).

### Rename + runtime version management

- Renamed the package and its single command to `dali-ui-preview-cli` (the `bin`,
  `repository`, and every `--help`/diagnostic string now use it).
- Runtime image versions track DALi releases as `dali_<DALiVersion>` tags (e.g. `dali_2.5.18`),
  plus the rolling `latest`.
- `--list-versions` prints the available runtime versions (remote registry ∪ local docker,
  each marked `local`/`current`) as JSON; tolerates docker being down (lists remote with
  `local: false`).
- `--pull [<tag>]` downloads a runtime image tag (default `latest`), streaming docker's
  progress to stderr and printing `{"pulled":"<ref>","ok":true}` to stdout.
- `--image-tag <tag>` selects the runtime tag for a render (default `latest`); `--runtime-image
  <name>` overrides the runtime image name (advanced). Both also apply to `--list-versions`
  and `--pull`.

## 0.1.0 — M0 (build infra + first end-to-end render)

- `dali-ui-preview-cli <input> --image <out.png>` — resolves DALi preview C++ from a
  `*.preview.dali.cpp` file (or `@dali-preview-begin/end` markers), renders it
  headlessly in the runtime Docker image, writes the PNG, and prints a minimal
  scene-tree JSON (per-node type + nesting) to stdout. `--version` / `--help`.
- Vendored the DALi harness template + C++/flex/error parsers for a self-contained
  release (ADR-007).
- A11y spike (ADR-008): `Accessibility::DumpTree` works headless **without** D-Bus,
  emitting a per-node semantic tree (role / states / text / type / bounds) — M1
  will consume it alongside the property walk.
