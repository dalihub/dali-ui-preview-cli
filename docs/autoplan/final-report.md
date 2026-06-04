# dali-ui-preview CLI — project completion report (autodev Mode 1)

## Milestones — all complete
| M | Title | Verdict | npm test |
|---|---|---|---|
| M0 | build infra + a11y spike | PASS (arch+external PASS) | render+tree |
| M1 | canonical tree schema | PASS (arch DRIFT-MINOR→ADR-009, external PASS) | 39 |
| M2 | Set-of-Mark image↔tree | PASS (overlay vision-confirmed) | 60 |
| M3 | dual output (tree/report/caps/watch) | PASS | 82 |
| M4 | verify loop (image+tree diff) | PASS | 95 |
| M5 | config flags + structured errors | PASS | 116 |
| M6 | packaging + release | PASS | 116 |
| final | comprehensive external review + fixes | CONCERN→fixed (1-based sourceLine, node text, persistent diffPNG, README) | 118 |

## Result
`dali-ui-preview <file | - | --code "...">` renders DALi UI C++ headlessly in the shared Docker runtime image and emits a deterministic canonical UI tree (id, mark, type, role, frame-accurate bounds, **text**, name, sourceLine[1-based], semanticsSource, properties, flexProps, children) + optional PNG. Features: Set-of-Mark overlay + coord↔node lookups; box-tree/HTML-MD report/token caps/watch; image+tree verify loop with verdict + exit codes; --resolution/--theme/--dpr + structured {phase,message,sourceLine} errors. No DALi source modified; container (image + ccache/shader volumes) shared with the DALi Preview VS Code extension.

## ✋ visual holds (human sign-off)
- M0 F0.3 render golden `tests/golden/hello-dali.png`
- M0 F0.5 DumpTree-headless spike verdict (ADR-008 — works without D-Bus)
- M2 F2.1 Set-of-Mark overlay legibility

## Tests
- `npm test`: **118 passing** (12 files; genuine assertions). Every feature validated by LIVE CLI execution (real docker renders) at each milestone.

## Architecture
- Node/TS orchestrator → one-shot `docker run` → vendored+extended C++ harness (public/devel DALi APIs only) → canonical tree + Capture PNG. 9 ADRs. Key finding (ADR-008): per-actor `Accessibility::Accessible::Get`/`DumpTree` work headless without D-Bus.

## Recommended next steps (human)
1. Push to GitHub + `npm publish` (then `npx dali-ui-preview`).
2. Wrap as an MCP server (agent-enablement doc stage 3) so Claude/Cursor call `render_preview(code)` directly.
3. Polish: c8 coverage config; richer control-type→role map; more golden samples; per-glyph text bounds if DALi later exposes them.
