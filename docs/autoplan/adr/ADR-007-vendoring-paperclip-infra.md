# ADR-007 — Vendoring vs referencing the paperclip infra

## Status
accepted

## Context
The reused paperclip infra (project-profile.md `reused_paperclip_infra`) lives in the **sibling** tree (`../server/...`, `../src/...`), not in this repo. This worktree currently tracks only `docs/` (confirmed: `git ls-files` shows just the four autoplan docs). M6 demands that a **fresh clone** of *this* repo runs `--help`, the README quickstart, the bundled examples, and a CI smoke job (F6.1–F6.4), and ships as a standalone GitHub release (F6.5). A relative `../` reference cannot survive a clone — the sibling won't be there.

The specific assets and their fit:
- `../server/preview_harness.cpp.template` — the render backend the CLI commits to (ADR-002). **Needs net-new edits**: replace hand-computed bounds with `CalculateCurrentScreenExtents` (ADR-003/F1.2), add stable-id + mark + sourceLine emission (ADR-004), add property-enumeration + reconstructed semantics + the optional DumpTree probe (ADR-003), and decouple the `name` vs `__L{line}` overload.
- `../src/cppParser.ts` — C++ chain → `SceneNode` with `sourceLine`. Reusable nearly as-is for the input-parse stage; it's already self-contained TypeScript with no `vscode` import.
- `../src/flexMetadata.ts` — source+runtime merge; pure TS, reusable as-is.
- `../src/errorParser.ts` — g++ error → `{line,column,message}` for M5/F5.3. **Imports `vscode`** and exposes `errorsToDiagnostics` (a VS Code Diagnostic adapter) — must be de-coupled from the editor API when vendored.
- The runtime **image** (`ghcr.io/lwc0917/dali-preview-runtime`) is *not* vendored — it's pulled from GHCR by tag (ADR-006), which is already a self-contained external artifact.

## Decision
**Vendor (copy into this repo), do not reference `../`.** Copy the harness template, `cppParser.ts`, and `flexMetadata.ts` into this repo's own tree, and copy `errorParser.ts` with its `vscode` dependency stripped (keep `parseGccErrors`/offset helpers, drop `errorsToDiagnostics`/the `import vscode`). Also vendor the `hello-dali` sample as the canonical fixture (M0/F0.2). The runtime image stays *referenced* by GHCR tag (a flag/config default), since it is independently published and pulled on demand. Each vendored file gets a header noting its paperclip origin + the commit/intent it was copied at, so drift is visible. The C++ harness is the one that diverges most (it gains all the net-new introspection), so vendoring — rather than sharing — is what lets this repo evolve the renderer without coordinating with the extension.

## Alternatives considered
- **Reference the sibling via `../` relative paths** — rejected: breaks the moment the repo is cloned standalone (F6.1–F6.5); the sibling is not part of this git repo (`git ls-files` proves it).
- **Git submodule / npm-publish the shared modules and depend on them** — rejected as premature: it couples this repo's release cadence to the extension's, and the harness needs *divergent* edits (new introspection) that a shared package would either block or force onto the extension; the shared surface is small (three TS files + one template) so a copy with provenance headers is lower-friction than maintaining a published shared lib. Can be revisited post-M6 if the modules stabilize.
- **Vendor the runtime image too (bake/ship it)** — rejected: it's ~1GB and already a first-class GHCR artifact pulled by tag; embedding it would bloat the repo and duplicate Docker's delivery (ADR-006).

## Consequences
- Good: a fresh clone is fully self-contained for source + harness + fixture (F6.1–F6.5); CI smoke can build and run from the clone alone.
- Good: this repo owns and can freely evolve the harness's introspection (ADR-003/004) without touching or being blocked by the extension.
- Good: the heavy image stays external + versioned by tag, keeping the repo and npm package small (ADR-006).
- Bad: vendored copies can drift from the paperclip originals over time; mitigated by provenance headers and by the fact that the harness is *intended* to diverge (the others rarely change).
- Neutral: `errorParser.ts` loses its VS Code Diagnostic adapter on copy — irrelevant to a CLI, which needs only the parsed `{phase,message,sourceLine}` for F5.3.

## Affected milestones
- M0, M1, M5, M6
