# M0 — ✋ visual holds (human sign-off queue)

## F0.3 — hello-dali render (WU-4)
- Baseline (auto-registered, first render): `tests/golden/hello-dali.png`
- Vision verdict (orchestrator, execution-tests §G option ③): **NO_GOLDEN_BUT_LOOKS_RIGHT**
- Expected: dark navy (#1e1e2e) background; column-centered large white "Hello, Dali!" heading; smaller gray subtitle "Edit this file to see the preview update" below; no corruption.
- Observed: matches exactly — dark bg, centered white heading, gray subtitle, clean. ✓
- **Human action**: confirm `tests/golden/hello-dali.png` looks correct — it becomes the pixel golden for M1/M4 diffing.

## F0.5 — a11y DumpTree spike verdict (WU-6)
- Artifacts: `docs/autoplan/m0/spike-dumptree-output.txt` + `adr/ADR-008-a11y-spike-result.md`
- Verdict: **DumpTree WORKS headless without D-Bus** (captured 1156-char per-node semantic JSON).
- **Human action**: confirm the ADR-008 verdict faithfully reflects the captured probe output — it does (SPIKE_GET non-null + `DumpTree out_chars=1156` + the JSON tree with role/states/text/type/bounds/children).
