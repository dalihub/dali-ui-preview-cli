# M0 — execution plan (WU sequencing)

> WU definitions + assertions live in `spec.md`. This file fixes only the ORDER the orchestrator
> implements + validates them — one at a time, validate-before-next (Cognition single-threaded rule).

## Order (critical path WU-1 → WU-5; WU-6 branches off WU-1)
1. WU-1 — skeleton + build + `--version`         [F0.1, Tier 3]
2. WU-2 — vendor infra + sample fixture          [F0.2, Tier 3]
3. WU-3 — inputResolver + harnessTemplater       [enables F0.3/F0.4, build smoke]
4. WU-4 — dockerRunner + CLI render → PNG         [F0.3, Tier 2 + ✋ vision judge]
5. WU-5 — treeModel + stdout JSON                [F0.4, Tier 2]
6. WU-6 — a11y spike + ADR-008                    [F0.5, Tier 3 + ✋]

No parallel implementation (single-threaded linear agent). ✋ holds (WU-4 render, WU-6 spike)
collected and reported at Phase 4 milestone wrap-up.

## CLI logging convention (adaptation of the parent CLAUDE.md rule)
This is a CLI, not the VS Code extension — there is no `outputChannel`. Therefore:
**stdout = the JSON contract only** (Inv-6); **all diagnostics/logs/`OK:`/compile output → stderr**.
`console.error`/`process.stderr` for diagnostics; `process.stdout.write` for the JSON tree.
