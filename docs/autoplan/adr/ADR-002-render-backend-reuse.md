# ADR-002 — Render-backend reuse strategy (one-shot harness vs long-running server)

## Status
accepted

## Context
The runtime image (`ghcr.io/lwc0917/dali-preview-runtime`) ships two render paths, confirmed by reading `../docker/Dockerfile.runtime`, `../src/dockerRuntime.ts`, and `../src/previewServer.ts`:

1. **One-shot harness** — `../server/preview_harness.cpp.template`: a `{{USER_CODE}}` placeholder is filled with the user's preview C++, the whole file is `g++`-compiled and run once via entrypoint `dali-preview-entrypoint /work/source.cpp`, it `Capture`s a PNG and writes a metadata JSON, prints `OK:<png>`, and exits. The user's *actual* C++ is compiled.
2. **Long-running server** — `../server/preview_server.cpp` (baked at `/opt/dali/bin/preview_server`, entrypoint `dali-preview-serve`): a persistent DALi `Application` that takes line IPC on stdin. Its `RENDER_JSON` path does **not** compile user C++ — it parses a lossy JSON DSL (`{type,constructorArgs,properties,children}`) reconstructed by `../src/cppParser.ts`, and rebuilds an *approximation* of the scene with a hand-written `SBBuildNode` switch that only knows Label/FlexLayout/StackLayout/ImageView/View. Its `RELOAD` path `dlopen`s a pre-compiled `.so`.

The CLI's input contract (project-goal.md) is real DALi UI **code** (file / snippet / stdin), and its headline promise is a faithful, deterministic render of *that code* plus a frame-accurate tree. The server's `RENDER_JSON` fidelity is bounded by the TS parser's coverage (it returns `null` on ternaries, control flow, unknown types) and by `SBBuildNode`'s hardcoded type list — anything outside that silently degrades to a bare `View`. The server's win is latency (no per-call compile), which matters for the extension's keystroke-debounced live preview but not for a CLI invocation that an agent runs once per edit.

## Decision
Adopt the **one-shot harness path as the single render backend**: for each invocation, template the user's C++ into a vendored copy of `preview_harness.cpp.template`, `docker run --rm` the runtime image to compile+render it, and read back the PNG + metadata JSON. Do **not** use the long-running `preview_server`/`RENDER_JSON`/`dlopen` paths. The harness is the only path that compiles the user's *real* source, which is required for fidelity, for honest compile-error reporting (M5/F5.3 via the g++ → source-line mapping), and for `__tag` source-line provenance (M1/F1.5). `watch` mode (M3/F3.4) re-invokes this same one-shot path on file change rather than holding a server open — accepting ~0.5–1s per render in exchange for never drifting from the compiled-code semantics.

## Alternatives considered
- **Long-running `preview_server` RENDER_JSON** (research.md "장수 preview_server.cpp(RENDER_JSON, 빠름)") — rejected: it renders a TS-parser reconstruction, not the user's C++, so it cannot honestly represent arbitrary input, cannot surface real compiler errors, and caps node types at `SBBuildNode`'s switch. Its only advantage (speed) is a live-preview concern, not a per-call CLI concern.
- **Long-running server + `dlopen` (`RELOAD`)** — rejected: it *does* compile user code, but adds a stateful server lifecycle (READY handshake, restart logic, container reuse, stdin IPC injection guards — all present in `previewServer.ts`) for a latency win the CLI doesn't need; the added moving parts hurt the determinism and self-containment goals.
- **Native DALi directly on host** (research.md "native DALi 직접") — rejected: defeats the fixed-image determinism invariant (project-profile.md `infra_gaps`: render inside the image to avoid host font/AA drift) and reintroduces a host SDK install the project explicitly avoids.

## Consequences
- Good: every render reflects the user's *actual* compiled C++ → faithful PNG + tree, honest compile errors, real source-line tags.
- Good: stateless, single `docker run` per call → simplest possible determinism story and self-containment (no server protocol to vendor/maintain).
- Good: the harness is small and forkable; the net-new introspection (CalculateCurrentScreenExtents, stable IDs, optional DumpTree — ADR-003/ADR-004) is added by editing this one vendored file.
- Bad: ~0.5–1s per render (container start + compile), and `watch` re-pays it each change; mitigated by the image's persistent `ccache`/shader-cache volumes (the harness body is constant except `{{USER_CODE}}`, so recompiles are cheap) — same volumes `dockerRuntime.ts` already mounts.
- Neutral: the baked `preview_server` binary is simply unused by the CLI; no need to remove it from the image.

## Affected milestones
- M0, M1, M2, M3, M5
