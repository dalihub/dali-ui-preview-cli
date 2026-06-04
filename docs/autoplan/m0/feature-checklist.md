# M0 — Build infra + a11y spike — FROZEN feature checklist

> Frozen at milestone start (P-4.0). Do NOT add/modify features during M0.
> New features discovered → `docs/autoplan/m0/oos-queue.md` (defer to a later milestone).
> Source: `plan.md` M0 section. Architecture already decided (ADR-001..007) — do not re-litigate the stack.

**Demonstration**: From a clean checkout, `npm run build` compiles the CLI with zero errors; `dali-ui-preview <bundled-sample> --image out/preview.png` runs the full path (parse → build/render in the runtime container under headless Xvfb/offscreen → capture) and produces a non-empty PNG + a minimal node tree as JSON on stdout. Separately, the a11y spike is resolved: an ADR records whether `Accessibility::Accessible::DumpTree` yields a semantic tree in the headless container WITHOUT a live D-Bus session, and which tree-source path the project takes.

**Out of scope (M0)**: rich/canonical tree schema (M1); stable IDs, overlay, diffing, config flags, structured-error contract, packaging (later milestones).

## Features (frozen)
- **F0.1** Project skeleton + reproducible build — clean clone → `npm install` → `npm run build` succeeds with zero errors and produces a runnable CLI entrypoint; `dali-ui-preview --version` prints a version string.
- **F0.2** Canonical sample fixture lands in-repo — a `hello-dali` preview sample committed under the repo as the fixed input every later milestone runs against.
- **F0.3** Container render + capture path wired end-to-end — given the sample, the CLI orchestrates a headless render in the runtime image and writes a non-empty PNG to a user-given path.
- **F0.4** Minimal tree emission — the same run prints a minimal JSON tree (≥ per-node concrete type + nesting) to stdout.
- **F0.5** ⚠️ A11y-bridge spike + decision record (ADR-008) — verify whether `DumpTree` produces a semantic tree headless without D-Bus; pick the tree source accordingly; ADR records yes/no + chosen path + the resulting M1 tree-schema direction. (Architecture is robust either way per ADR-003/Inv-2 — this records the empirical result, does not block M1.)
