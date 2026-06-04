# Changelog

## Unreleased — M1 (canonical tree schema)

- Canonical scene tree: every node carries `id` (structural path like `0/1/0`),
  `type`, `role` (type→role map), frame-accurate `bounds{x,y,w,h}`
  (`CalculateCurrentScreenExtents`), `name`, `semanticsSource` (`bridge`|`reconstructed`),
  `sourceLine`, and `children`.
- Deterministic output: two renders of the same input are byte-identical.
- Input modes: a file path, a `-`/piped **STDIN** code block, or inline `--code "<text>"`.
- `--image` is now optional — a bare invocation prints the tree JSON to stdout.
- Empty input is rejected immediately (clear error, no container spin-up).
- 39 unit tests (treeModel / inputResolver / harnessTemplater / errorParser); `npm test` builds then runs them.

## 0.1.0 — M0 (build infra + first end-to-end render)

- `dali-ui-preview <input> --image <out.png>` — resolves DALi preview C++ from a
  `*.preview.dali.cpp` file (or `@dali-preview-begin/end` markers), renders it
  headlessly in the runtime Docker image, writes the PNG, and prints a minimal
  scene-tree JSON (per-node type + nesting) to stdout. `--version` / `--help`.
- Vendored the DALi harness template + C++/flex/error parsers for a self-contained
  release (ADR-007).
- A11y spike (ADR-008): `Accessibility::DumpTree` works headless **without** D-Bus,
  emitting a per-node semantic tree (role / states / text / type / bounds) — M1
  will consume it alongside the property walk.
