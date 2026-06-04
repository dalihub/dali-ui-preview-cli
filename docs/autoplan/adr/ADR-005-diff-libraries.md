# ADR-005 — Image-diff + tree-diff libraries

## Status
accepted

## Context
M4's verify loop needs two diffs:
- **Image-diff** (F4.1): render vs a baseline PNG → a quantitative score + a visual diff artifact + a threshold pass/fail.
- **Tree-diff** (F4.2): current tree vs a target tree, **keyed on the stable IDs** from ADR-004, reporting added / removed / changed nodes (per-node, not just "something changed").

research.md candidates: image-diff = `pixelmatch + pngjs` (noted "이미 의존") **or** `odiff`; tree-diff = a custom JSON diff **or** `deep-diff`. The sibling `../package.json` confirms `pixelmatch ^7.1.0` and `pngjs ^7.0.0` are already devDependencies, and they are the canonical pairing in research.md's `jest-image-snapshot/pixelmatch` reference for golden + `failureThreshold` flows.

## Decision
**Image-diff: `pixelmatch` (^7.1.0) + `pngjs` (^7.0.0).** Decode both PNGs with `pngjs`, run `pixelmatch` to get a changed-pixel count → normalize to a 0–1 score against total pixels (the threshold an agent branches on, F4.3), and write `pixelmatch`'s diff buffer back out via `pngjs` as the visual diff artifact. These ship with the project already and match the determinism story (the baseline and the candidate are both rendered inside the same fixed image, so AA/font drift — research.md's golden-flakiness pitfall — is controlled at the source, not papered over by a high threshold).

**Tree-diff: a custom JSON diff keyed on the stable `id`.** Build a map `id → node` for both trees, then: ids only in current = *added*, ids only in target = *removed*, ids in both with differing `{type, bounds, key properties, role}` = *changed* (emitting the specific changed fields). This is a thin, well-scoped function (the schema is ours and small) and — critically — it diffs on *identity* (ADR-004's structural path), which a generic structural differ cannot do.

## Alternatives considered
- **`odiff`** (image-diff) — rejected: faster on huge images, but it's an external native binary to provision (cutting against self-containment / npx install, ADR-006/ADR-007) and would *add* a dependency where `pixelmatch`+`pngjs` are already present and already used for goldens in the sibling tree.
- **`deep-diff`** (tree-diff) — rejected: it diffs arbitrary object graphs positionally/by-path and has no notion of our stable `id`, so a reordered child or an added sibling produces noisy path-based deltas instead of the clean added/removed/changed-**by-id** report F4.2 specifies. The custom diff is small precisely because it exploits the id key we already own.

## Consequences
- Good: zero new runtime dependencies for diffing — `pixelmatch`/`pngjs` already vendored, image artifact reuses the same `pngjs` encode path as capture read-back.
- Good: tree-diff semantics align exactly with the stable-ID contract (ADR-004), so the verify loop reports meaningful node-level changes (F4.2/F4.3).
- Bad: the custom tree-diff is code we maintain (vs an off-the-shelf lib); mitigated by it being a few-dozen-line map-compare over a schema we control, and directly unit-testable (test tier-3).
- Neutral: image score normalization (changed px / total px) is a project convention; documented in the M4 threshold contract and echoed in output so callers know what the number means.

## Affected milestones
- M4
