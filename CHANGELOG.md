# Changelog

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
