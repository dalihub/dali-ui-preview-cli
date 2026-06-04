# ADR-004 — Stable-ID strategy

## Status
accepted

## Context
Multiple features hinge on a node identity that survives across runs and is shared by the tree and the image:
- F1.3: IDs derived deterministically, **not memory addresses**, identical across two runs.
- F2.2: overlay mark IDs and tree node IDs come from **one shared source** so they cannot drift (Set-of-Mark, project-goal.md differentiator #2; research.md arXiv 2310.11441).
- F2.3/F2.4: coordinate→node and node→image-region lookups key on this ID.
- F4.2: tree-diff is **keyed on stable IDs** to report added/removed/changed nodes.

Constraints discovered in the existing harness (`../server/preview_harness.cpp.template`):
- It emits `name` but **no id**.
- It (and `preview_server.cpp`'s `SBBuildNode`) overloads `Actor::Property::NAME` to carry the `__L{sourceLine}` click-to-code tag — i.e. the runtime "name" slot is already spoken for and is **not** a stable human label. So the ID must not be sourced from `Actor::Property::NAME`, and the human `name` field must be reconstructed separately (from the source tag and/or content), not read blindly from NAME.
- `cppParser.ts` already attaches an absolute `sourceLine` to each `SceneNode`, and the harness already tags actors `__L{line}`.

DALi gives a per-actor `GetId()`, but it is a process-local handle counter — non-deterministic across runs (allocation-order dependent), exactly the "memory address" class F1.3 forbids.

## Decision
Derive each node's stable ID **deterministically from the node's position in the tree, anchored to source where available** — never from `GetId()` or any pointer. The canonical ID is the node's **structural path**: the root is `0`, and each node's id is its parent's id joined with its zero-based child index (e.g. `0/2/1`), assigned during the single depth-first walk that also emits the tree (so the *same* walk produces tree node ids and the numbers stamped onto the overlay — one source, cannot drift, satisfying F2.2). Because children are emitted in a fixed, sorted order (Inv-3 / F1.4), the path is reproducible run-to-run on identical input (F1.3). The originating `__L{sourceLine}` tag is carried **alongside** as a `sourceLine` field (F1.5) — used for provenance and to make IDs human-meaningful in reports — but the *identity* is the structural path, so two sibling nodes from the same source line still get distinct IDs. The compact integer "mark" shown on the overlay (Set-of-Mark) is a 1-based ordinal assigned in the same DFS and stored on each node as `mark`, with a `mark ↔ id` table in the output so a caller can use either; both come from the one walk.

## Alternatives considered
- **DALi `Actor::GetId()`** — rejected: a process-local allocation counter; varies across runs → violates F1.3's "not memory addresses / identical across runs."
- **Hash of node properties (type+bounds+text)** — rejected: not stable under the verify loop's whole purpose — when an agent edits text or nudges a position to approach the target (F4.2), a property hash changes identity, so the tree-diff would report "node removed + node added" instead of "node changed," destroying the diff's usefulness.
- **`sourceLine` alone as the ID** — rejected: not unique (a `.Children({...})` list can put several `::New()` calls on one line; loops/macros reuse a line), so it cannot key F2.2 set-equality or F4.2 per-node diff. Kept as a *provenance* field, not the identity.
- **Author-supplied keys (`key=` on nodes)** — rejected for the default: the input is plain DALi C++ with no key convention, and requiring annotations breaks the "render arbitrary code" promise. The structural path needs nothing from the author.

## Consequences
- Good: deterministic and addressless by construction (F1.3); one DFS feeds tree ids + overlay marks so they are provably the same set (F2.2, Inv-1).
- Good: identity is stable under content/position edits, so tree-diff reports true changes, not churn (F4.2).
- Good: no dependency on the a11y bridge or on `Actor::Property::NAME` (which is occupied by the source tag).
- Bad: inserting/reordering a sibling shifts the indices of later siblings, so their ids change — acceptable because that *is* a structural change the diff should reflect, and the carried `sourceLine` still lets a human re-anchor.
- Neutral: `sourceLine` provenance and the structural id are complementary, not competing; both appear on every node.

## Affected milestones
- M1, M2, M4
