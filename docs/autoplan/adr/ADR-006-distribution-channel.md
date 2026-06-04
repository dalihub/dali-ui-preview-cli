# ADR-006 — Distribution channel

## Status
accepted

## Context
M6 (plan.md F6.3) requires the CLI be packaged for "the chosen distribution channel" so an external user can install and run it from outside the dev tree, and F6.5 requires a tagged GitHub release with artifacts + changelog. project-goal.md states the eventual target is a GitHub release and emphasizes the AI-agent install path. research.md candidates: **npm package (npx)**, **GitHub Releases pre-built binary**, **Docker wrapping**.

A defining fact: the CLI does **not** render anything itself — it shells out to the `ghcr.io/lwc0917/dali-preview-runtime` image, which is the real ~1GB payload and is pulled by `docker` on first use (the sibling `dockerRuntime.pullImage` already handles this with progress). So "distributing the CLI" means distributing a thin Node program; the heavy artifact is delivered out-of-band by Docker regardless of channel.

## Decision
Distribute as an **npm package runnable via `npx dali-ui-preview`** (a `bin` field in `package.json`), published to npm and tagged on GitHub (F6.5) with the source + a `CHANGELOG.md` entry. The runtime image continues to be delivered by `docker pull` of the GHCR image on first render — the CLI only orchestrates it (ADR-002), so the npm artifact stays small and version-independent of the image (image tag is a CLI flag/config, mirroring `daliVersionTag` in the sibling). This is the lowest-friction path for the dual audience: a human runs `npx dali-ui-preview ...`; an agent does the identical one-liner with no binary to fetch or unpack, and it reuses the Node/TS toolchain chosen in ADR-001.

## Alternatives considered
- **GitHub Releases pre-built binary** (e.g. `pkg`/`nexe` single-file Node bundle) — rejected as the *primary* channel: it solves "no Node on host," but Node is already a prerequisite of the chosen stack and Docker is the actual blocker; a per-OS binary matrix to build/host adds release complexity for a program whose job is to spawn `docker`. (A GitHub release of the npm tarball + source still happens for F6.5; this just isn't the install mechanism.)
- **Docker wrapping the CLI itself** (ship the CLI inside a container that runs the runtime image) — rejected: would require docker-in-docker or socket-mounting just to reach the render image, a fragile setup that hurts the "fresh clone runs `--help` and the quickstart" acceptance (F6.2) and the agent ergonomics.

## Consequences
- Good: `npx`/global-install is the most agent- and human-friendly install (project-goal.md), single command, no artifact matrix.
- Good: CLI version and runtime-image version decouple cleanly — image is a flagged GHCR tag pulled on demand, so the npm package never embeds the 1GB payload.
- Good: aligns with ADR-001 (Node/TS) and the sibling's existing GHCR pull machinery, which can be lifted for the CLI's first-run image pull.
- Bad: requires Node + Docker on the host (two prereqs); documented in README quickstart (F6.2) and surfaced by a preflight check (the CLI verifies `docker info` before rendering, reusing the `isAvailable` pattern).
- Neutral: the GitHub release (F6.5) carries the source tarball + changelog for provenance even though install is via npm.

## Affected milestones
- M6
