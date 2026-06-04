# ADR-008 — M0 a11y-spike empirical result: DumpTree works headless

## Status
accepted (records the empirical M0/F0.5 spike result; does NOT supersede ADR-003 — it confirms ADR-003's "DumpTree-available" branch is the reality)

## Context
ADR-003 made the tree source robust to an UNKNOWN: whether `Accessibility::Accessible::DumpTree` yields a semantic tree in the headless runtime container **without a live D-Bus session**. The M0/F0.5 spike was to answer this empirically before M1 fixes the tree schema. Captured evidence: `docs/autoplan/m0/spike-dumptree-output.txt`.

## Decision
**The answer is YES — `DumpTree` works headless without D-Bus.** A probe (`Accessibility::Accessible::Get(rootLayer)->DumpTree(DUMP_FULL)`, header `dali/devel-api/atspi-interfaces/accessible.h`) compiled and ran inside `ghcr.io/lwc0917/dali-preview-runtime:latest` under Xvfb with no D-Bus session and returned **1156 chars of valid per-node JSON** — `role`, `states` (bitset), `text` (name), concrete `type`, `x/y/w/h` bounds, `path`, `attributes`, nested `children`. DALi builds its internal accessible tree in-process; D-Bus is only needed to EXPOSE that tree to an external AT-SPI client (screen reader), not to read it locally via DumpTree. The "Accessibility is disabled" / "cannot get dbus connection" log lines refer to that external-bridge registration, which is irrelevant to local DumpTree.

Therefore M1 will treat **DumpTree as a usable headless semantic + geometric source**, merged with the property-walk (`CollectActorMetadata`) for fields DumpTree omits (user text/background colors, `flexProps`), and a **control-type → role mapping** to fix DumpTree's default roles (which are mostly `"unknown"`/`"redundant object"` because the dali-ui DSL controls do not set an explicit `ACCESSIBILITY_ROLE`). The **property-reconstructed walk remains the guaranteed floor** (ADR-003 / Inv-2): if a future runtime image lacks the atspi devel headers or the bridge, the tree still builds from `GetTypeName` + `GetPropertyIndices` + `CalculateCurrentScreenExtents`.

## Alternatives considered
- **Property-reconstructed walk ONLY (ADR-003's pessimistic default)** — rejected as the *sole* source now that DumpTree is proven available: it would discard a free, ready-made semantic JSON (role/states/path) that we'd otherwise re-derive by hand. It is retained as the floor, not the ceiling.
- **DumpTree ONLY** — rejected: its default roles are `"unknown"` (no value without a type→role map), it omits the user's text/background colors and `flexProps` that `CollectActorMetadata` captures, and depending on it alone would violate Inv-2 (break if a future image lacks the bridge).

## Consequences
- **Good**: a rich semantic+geometric tree is available headless for free — `role`, `states`, `text`, `type`, `x/y/w/h`, `path`, `attributes`. DumpTree already emits **bounds (x/y/w/h)**, a candidate for M1/F1.2 alongside `CalculateCurrentScreenExtents`. Confirms the architecture's Inv-2 robustness held (the "bridge works" branch is real).
- **Bad**: default roles are poor (`"unknown"`/`"redundant object"`) → M1 must add a control-type→role map. The headless D-Bus failure emits a LOUD stderr deluge (eldbus backtraces) that M5's error path must filter so it never pollutes the structured error contract.
- **Neutral**: M1 now merges TWO sources (DumpTree + property-walk) instead of one — a join keyed on actor identity/child-index order is needed.

## Affected milestones
- **M1** — tree schema can consume DumpTree's role/states/text/type/bounds; add type→role map; merge with property-walk for colors/flex; decide bounds source (DumpTree x/y/w/h vs CalculateCurrentScreenExtents).
- **M2** — DumpTree's per-node bounds are usable for Set-of-Mark overlay/coordinate mapping.
- **M5** — must filter the headless eldbus/D-Bus stderr noise out of the structured error output.
