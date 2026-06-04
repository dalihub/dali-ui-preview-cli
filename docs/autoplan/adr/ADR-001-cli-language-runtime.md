# ADR-001 — CLI language / runtime

## Status
accepted

## Context
`dali-ui-preview` is an orchestrator CLI (project-profile.md `runtime_model`): it parses input, drives a Docker container to render, then captures + formats a PNG and a UI tree. The actual rendering happens in C++ inside the fixed runtime image, so the host-side language only needs to: shell out to `docker`, template a C++ harness string, read back a PNG + a JSON metadata file, diff images/trees, and format output (JSON / box-drawing tree / HTML-MD). Two audiences consume it — humans at a terminal and AI agents in a write→preview→verify loop (project-goal.md) — so install friction and "AI can run it" matter. research.md lists four candidates: Node/TypeScript, Go, Rust, Python.

The reuse surface is decisive: `../src/cppParser.ts` (DALi C++ chain → SceneNode, with `sourceLine`), `../src/flexMetadata.ts` (source+runtime merge), and `../src/errorParser.ts` (g++ error → `{line,column,message}`) are **all TypeScript**, and `pixelmatch`+`pngjs` (image-diff, F4.1) are already npm dependencies of the sibling project. Picking any non-Node language would force a rewrite of all three parsers plus re-sourcing the diff stack.

## Decision
Use **Node.js (host toolchain v24.14.1) + TypeScript ^5.9.3**, compiled with `tsc` to `out/`, exposed as a `bin` entry runnable via `npx dali-ui-preview` and as a global install. This directly reuses the three TypeScript modules and the `pixelmatch`/`pngjs` pair, keeps the orchestration code in the same language as the infra it wraps, and gives the lowest install friction for agents (an `npx` one-liner, no toolchain to provision since `node`/`npm` are already required to build).

## Alternatives considered
- **Go (single static binary)** — rejected: research.md's stated win is "단일 정적 바이너리" (single static binary distribution), but the CLI is not CPU-bound and ships *with* a ~1GB Docker image anyway, so a self-contained host binary buys little; meanwhile it would orphan `cppParser.ts`/`errorParser.ts`/`flexMetadata.ts` and the `pixelmatch` dependency, forcing a full parser+diff reimplementation.
- **Rust (single binary)** — rejected for the same reuse reason as Go, with a steeper build/iteration cost that is unjustified for what is essentially process-orchestration + JSON shaping.
- **Python** — rejected: research.md itself flags it "빠르나 배포 무거움" (fast to write but heavy to distribute); no PyPI packaging advantage over `npx` for agents, and again no reuse of the existing TS parsers.

## Consequences
- Good: zero-rewrite reuse of `cppParser`/`flexMetadata`/`errorParser` and `pixelmatch`/`pngjs`; single language across CLI + sibling extension; `npx` install is the most agent-friendly channel (see ADR-006).
- Good: TypeScript strict mode + the existing test patterns (mocha/c8) transfer directly, satisfying plan.md M0 "build succeeds, zero errors".
- Bad: ships a Node runtime expectation on the host (mitigated — Node is already a build prerequisite, and Docker is the real heavy dependency).
- Neutral: the C++ render/introspection code is authored separately (see ADR-002/ADR-003) and lives behind a process boundary, so the language choice does not constrain the renderer.

## Affected milestones
- M0, M1, M3, M4, M5, M6
