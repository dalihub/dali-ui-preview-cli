# M5 — config + structured errors — validated by real execution
- build 0 err; `npm test` **116 passing** (+21). In-container source basename → `preview_harness.cpp` so vendored `parseGccErrors` matches g++ diagnostics; render REGRESSION OK (normal render still exit 0).
- F5.1 `--resolution 800x480` → root.bounds 800x480; `--dpr 2 --resolution 400x300` → device 800x600; `--theme light|dark` → different background.
- F5.2 `root.meta = {resolution:{w,h}, theme, dpr}` echoes effective config (logical resolution + dpr).
- F5.3 broken code (`Banana::DoesNotExist()`) → stderr `{"phase":"compile","message":"'Banana' has not been declared","sourceLine":0}`; stdout empty.
- F5.4 exit codes: 0 ok / 1 usage+empty / 10 compile / 11 render / 12 docker-down / 20 diverge — broken code → **exit 10**.
- Verdict: PASS
