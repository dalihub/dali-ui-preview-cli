# ADR-003 — Tree-source robustness to the a11y spike

## Status
accepted

## Context
M1's node schema (plan.md F1.1) needs, per node: `{ id, type, role/semantics, name, bounds{x,y,w,h}, key properties, children }`. research.md's DALi "정보 천장" gives two ways to source this tree:

- **Semantic tree (nearly free)** — `Accessibility::Accessible::Get(actor)->DumpTree(DUMP_FULL)` yields role, name, states, value, type, automationId, and x/y/w/h per node, with Label/Button/Entry/Slider auto-populating role+name+value. **But** research.md and project-profile.md `infra_gaps` flag this as the project's #1 unknown: the AT-SPI bridge may need a D-Bus session that does not exist in the headless container. This is reinforced by direct evidence in the sibling code — `../src/previewServer.ts` already filters away `ERROR: DALI:.*(dbus|Accessibility|DBusClient)` noise that fires "many times per render in headless containers," so the bridge is observably unhappy headless today.
- **Property-reconstructed (always available)** — `Handle::GetPropertyIndices()` + `GetCurrentProperty()` enumerate every Actor/Control/TextLabel property; `BaseHandle::GetTypeName()` gives the concrete type (with `""→"Actor"` fallback, already in the harness `ShortTypeName`); `DevelActor::CalculateCurrentScreenExtents(actor)` gives frame-accurate bounds; and `DevelControl::ACCESSIBILITY_*` + a per-control default-role table reconstruct *semantics* without the bridge. This is local C++ with no D-Bus dependency.

The existing harness `CollectActorMetadata` is already a property-walk (it reads NAME/POSITION/SIZE/type/visible/opacity/color), but it computes bounds with fragile hand-rolled parentOrigin/anchor math that research.md explicitly says to replace.

The risk: if M1 hard-depended on `DumpTree` and the bridge is dead headless, the whole tree schema collapses. M0/F0.5 is the spike that resolves the yes/no.

## Decision
Define **one tree-source interface in the C++ introspection layer with two interchangeable implementations**, and make the **property-reconstructed walk the default/guaranteed path**. The harness always emits the canonical schema from the property walk: type via `GetTypeName()`, bounds via `CalculateCurrentScreenExtents()` (replacing the hand math), semantics via a `controlType → defaultRole` table plus `DevelControl::ACCESSIBILITY_*` overrides and content properties (text → name/value). The `DumpTree`-based semantic source is an **optional enrichment** gated behind a runtime capability probe: at startup the harness attempts the bridge once; if it produces a usable tree it *augments* role/name/value/automationId, otherwise it is silently skipped and the property-reconstructed values stand. M0/F0.5's spike result is recorded in **ADR-008** (the empirical yes/no), but the *architecture* commits now to never failing when the answer is "no." M1's schema is byte-identical in shape either way; only the richness of `role`/`automationId` varies, and a `semanticsSource: "bridge" | "reconstructed"` field in the output metadata makes which path ran auditable.

## Alternatives considered
- **Hard-depend on `Accessible::DumpTree`** (research.md "의미 트리(거의 공짜)") — rejected: gated on the unverified D-Bus-in-container question; sibling logs already show the bridge erroring headless, so betting the schema on it risks an unrenderable M1.
- **Property walk only, no semantics at all** — rejected: drops the `role/semantics` field F1.1 calls for and the Set-of-Mark/agent-targeting value (project-goal.md differentiator #2); reconstructing role from a control-type table is cheap and bridge-free, so there is no reason to omit it.
- **Keep the existing hand-computed bounds** — rejected: research.md names `parentOrigin/anchor 수식` as a known fragility and prescribes `CalculateCurrentScreenExtents`; F1.2 requires frame-accurate bounds.

## Consequences
- Good: M1 cannot be blocked by the a11y outcome — the guaranteed path needs no D-Bus (Inv-2 in architecture.md).
- Good: if the spike says the bridge *does* work, richer role/automationId data flows in for free without a schema change.
- Good: `semanticsSource` in metadata makes the chosen path explicit and testable (a reviewer can assert which ran).
- Bad: two code paths to keep behind the interface; mitigated by the bridge path being pure additive enrichment over a single canonical emitter.
- Neutral: the empirical spike answer is deferred to ADR-008 (written during M0); this ADR fixes the *structure* that makes either answer safe.

## Affected milestones
- M0, M1, M2
