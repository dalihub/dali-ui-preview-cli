# M2 — Image↔tree linking (Set-of-Mark) — FROZEN feature checklist

> Frozen (P-4.0). New features → docs/autoplan/m2/oos-queue.md. Source: plan.md M2.

**Demonstration**: a render emits a PNG annotated with numbered marks whose numbers equal the
tree nodes' `mark` values; `--at X,Y` returns the node at a pixel; `--node <id>` returns its
image box. Marks and tree ids come from ONE source (cannot drift).

**Out of scope (M2)**: box-tree / report / token caps / watch (M3); image-diff / tree-diff / verdict (M4); config flags + structured errors (M5); packaging (M6).

## Features (frozen)
- **F2.1** Set-of-Mark overlay — `--overlay <png>` (or `--marks` with `--image`) writes the rendered PNG annotated with a numbered box per meaningful node, the number = that node's `mark`. Each tree node carries a stable ordinal `mark` (assigned deterministically in one DFS over the canonical tree).
- **F2.2** ID/mark parity — every mark drawn on the overlay appears in the tree and vice-versa (set equality); marks come from the SAME tree the JSON is built from (Inv-1).
- **F2.3** Coordinate → node — `--at X,Y` prints the topmost node (smallest containing box) whose `bounds` contain pixel (X,Y): `{id, mark, type, role}` (or a clear "no node" message).
- **F2.4** Node → image region — `--node <id>` prints that node's `bounds {x,y,w,h}` (and mark/type), so a caller can crop/confirm it against the overlay.
