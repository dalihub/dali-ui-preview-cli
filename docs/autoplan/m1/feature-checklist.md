# M1 — Core render + canonical tree schema — FROZEN feature checklist

> Frozen at milestone start (P-4.0). Do NOT add/modify features during M1.
> New features discovered → `docs/autoplan/m1/oos-queue.md`.
> Source: `plan.md` M1 section + `docs/autoplan/m0/m1-carryover.md` (folded in) + ADR-008.

**Demonstration**: On the bundled sample, `dali-ui-preview samples/hello-dali.preview.dali.cpp`
prints a complete, **deterministic** JSON tree where every node carries a concrete **type** (never
bare/name-only), a **role** (semantic), **frame-accurate bounds** `{x,y,w,h}` matching the rendered
frame, and a **stable id** — and running the command twice yields **byte-identical** stdout.

**Out of scope (M1)**: image overlay / Set-of-Mark visuals (M2); box-tree / report / token caps / watch (M3);
image-diff / tree-diff / verdict (M4); config flags `--theme/--resolution/--dpr` + structured-error contract (M5);
packaging (M6).

## Features (frozen)
- **F1.1** Canonical node schema — each node exposes `{ id, type, role, name, bounds{x,y,w,h}, key properties, children }`. A node's concrete type is always present (typed default e.g. `Actor`/`Layer` when `GetTypeName()` is empty — never name-only). Semantics from DumpTree (ADR-008), with a **control-type → role map** to replace DumpTree's default `"unknown"` roles for the common controls (Label/Button/Image/Flex/Layer). `semanticsSource` records `"dumptree"` vs `"reconstructed"`.
- **F1.2** Frame-accurate bounds — node bounds come from the render-frame screen extents (`DevelActor::CalculateCurrentScreenExtents`, or DumpTree's x/y/w/h), NOT the hand-rolled parent-origin/anchor math. A node's reported box matches where it visibly sits in the rendered PNG within tolerance.
- **F1.3** Stable IDs across runs — ids are derived deterministically (structural-path / child-index chain, source-anchored via `sourceLine`; NOT memory addresses or process-local counters). Two runs on the sample produce identical ids for the same nodes; an id survives a content/position edit (so M4 tree-diff reports "changed", not remove+add).
- **F1.4** Determinism guarantees — fonts fixed, animations disabled, memory addresses/pointers stripped, children emitted in a stable sorted order. Two consecutive tree dumps of the sample diff to **zero bytes**.
- **F1.5** Source-line provenance — each node, where derivable, carries the originating source line (reusing the harness `__tag`/`__L{line}` mechanism). A caller can map a tree node back to the line of input code that produced it.

## Folded-in carry-over (from m0/m1-carryover.md) — must be satisfied within M1
- **Unit tests**: add runnable unit tests under `src/test/unit/` (→ `out/test/unit/`) for the pure modules (`treeModel`, `harnessTemplater`, `inputResolver`, and the new id/schema/role-map logic). `npm test` must run GREEN (becomes a real Gate A).
- DumpTree↔property-walk **merge** keyed on actor identity / child-index order (ADR-008).
- (Deferred to their milestones, NOT M1: Inv-6 image-on-demand → M3; eldbus stderr filtering → M5.)
