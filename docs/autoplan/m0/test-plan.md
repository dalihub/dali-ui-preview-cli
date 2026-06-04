# M0 — Execution test plan (FROZEN features F0.1–F0.5)

> Authored by the test-planner agent at milestone start.
> Tier definitions are taken verbatim from `references/execution-tests.md` — not invented here.
> This project is category **E (CLI tool)** + **F (native graphics)** for the in-container render + **G (visual judge)** for the rendered PNG.
> Per execution-tests.md §E/§F, **there is no Tier 1 for a CLI**; the *render* uses §F's framebuffer-dump idea but, because this is the FIRST render with **no golden image yet**, the rendered-PNG check uses §G **option ③ (Claude vision judge)** with auto-baseline + ✋, NOT a pixel-diff against a non-existent golden (execution-tests.md §G "First run / baseline 없음" + project-profile.md `tier1: yes-after-M0`).
>
> Conventions used by every command below (all grounded against the real sibling infra and this host):
> - `cwd` = repo root (`/home/woochan/tizen/paperclip/dali-ui-preview`), and `npm run build` has already run (→ `out/cli.js`).
> - Dev invocation is `node out/cli.js …` (the `bin` named `dali-ui-preview` is wired in F0.1; `node out/cli.js` is the build-output entry that the bin shims to, so commands stay runnable before a global link).
> - The canonical input is the in-repo sample **`samples/hello-dali.preview.dali.cpp`** (F0.2) — a column-centered dark UI (`0x1e1e2e`) with two text labels: "Hello, Dali!" (48px white) and a gray subtitle.
> - **No `jq` on this host** → JSON assertions use `node -e` (always present once F0.1 builds). PNG is sniffed via the `file` util / 8-byte PNG magic (`\x89PNG\r\n\x1a\n`).
> - Render path = `docker run --rm` against `ghcr.io/lwc0917/dali-preview-runtime:latest` (present locally, ~1.19GB); the harness prints `OK:<png-path>` to stdout and exits 0 on success (sibling `dockerRuntime.buildAndCapture` + `preview_harness.cpp.template` contract).
> - Timeouts follow execution-tests.md "공통 규칙": render (≈§F Tier 1/2) ≤ 60s, stdout-assert (§E Tier 2) ≤ 30s, smoke (Tier 3) ≤ 10s — except the render commands, which use 90s because the very first container compile pays the un-cached ccache/shader cost.

---

## F0.1 — Project skeleton + reproducible build
- Tier: **3**  (execution-tests.md §E Tier 3 "Version smoke" — clean clone → install → build must yield a runnable launcher that prints a semver-like string on `--version`. §E note: "binary 빌드 실패 → FAIL gate" — a broken build sinks every other feature, so this is the root gate.)
- Command:
  ```bash
  set -e
  npm install
  npm run build                       # tsc → out/ ; MUST exit 0 with zero errors
  test -f out/cli.js                  # runnable entrypoint produced
  VER=$(node out/cli.js --version)    # dev invocation of the bin entry
  echo "version => $VER"
  echo "$VER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'   # semver-like
  ```
- Pass condition: `npm run build` exits 0 (no `error TS` lines on stderr) **and** `out/cli.js` exists **and** `node out/cli.js --version` exits 0 printing a string matching `^[0-9]+\.[0-9]+\.[0-9]+` (e.g. `0.1.0`). Whole block exits 0.
- Golden: n/a
- ✋: no — fully auto-assertable (build success + semver regex).
- Pre-conditions: clean checkout; Node v24.14.1 + npm 11.11.0 on PATH (project-profile.md `host_toolchain`); network access for `npm install` on first run.

---

## F0.2 — Canonical sample fixture lands in-repo
- Tier: **3**  (execution-tests.md "Recipe 누락 시" heuristic step 3: a fixture has no runtime behavior of its own → assert existence + that it is the documented, non-empty, well-formed "run this" input. This is a Tier-3 artifact-existence check.)
- Command:
  ```bash
  SAMPLE=samples/hello-dali.preview.dali.cpp
  test -s "$SAMPLE"                                  # exists and is non-empty
  grep -q 'Hello, Dali!' "$SAMPLE"                   # the canonical label
  grep -Eq 'FlexLayout::New|return ' "$SAMPLE"       # is real preview C++, not a stub
  git ls-files --error-unmatch "$SAMPLE"             # committed (tracked), not stray
  echo "sample ok => $SAMPLE"
  ```
- Pass condition: the file `samples/hello-dali.preview.dali.cpp` exists, is non-empty, contains the literal `Hello, Dali!`, contains a `FlexLayout::New` chain or `return ` (i.e. genuine preview source), and is git-tracked. Block exits 0.
- Golden: n/a
- ✋: no — pure existence/content assertion.
- Pre-conditions: F0.1 build green (repo skeleton exists so `samples/` is in place).

---

## F0.3 — Container render + capture path wired end-to-end
- Tier: **2**  (execution-tests.md §F "Game / Graphics / Native" Tier 1 produces a framebuffer dump, but §E forbids Tier 1 for a CLI and §G says first-render-no-golden uses the vision judge, not pixel-diff. So the *mechanical* assertion — "one command → exit 0 → non-empty PNG at the user-given path" — is the §E Tier-2 "subprocess + stdout + artifact" contract; the §F software-GL fallback `GALLIUM_DRIVER=llvmpipe` is already baked into the runtime image. The PNG's *visual correctness* is checked separately by the ✋ vision judge below.)
- Command:
  ```bash
  OUT=/tmp/m0-f0.3-preview.png
  rm -f "$OUT"
  node out/cli.js samples/hello-dali.preview.dali.cpp --image "$OUT"
  RC=$?
  echo "exit=$RC"
  [ "$RC" -eq 0 ]                                    # CLI succeeded
  test -s "$OUT"                                     # PNG written and non-empty
  file "$OUT" | grep -q 'PNG image data'            # real PNG (magic bytes), not a stray text/error file
  # belt-and-suspenders magic-byte check (no 'file' util dependency):
  node -e 'const b=require("fs").readFileSync(process.argv[1]);const sig=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);process.exit(b.length>100 && b.subarray(0,8).equals(sig)?0:1)' "$OUT"
  ```
  Timeout: 90s (first un-cached container compile).
- Pass condition: CLI exits 0; `/tmp/m0-f0.3-preview.png` exists, is > 100 bytes, and begins with the PNG signature `89 50 4E 47 0D 0A 1A 0A` (so it is genuinely an image, not an error message captured to the path). Block exits 0.
  - Visual-correctness pass is delegated to the §G vision judge (see ✋ row): capture this same PNG, Read it, and require verdict `EQUIVALENT` / `MINOR_DIFF` / `NO_GOLDEN_BUT_LOOKS_RIGHT` against the acceptance criteria *"dark (near-black/navy) background, a column-centered large white 'Hello, Dali!' heading with a smaller gray subtitle line below it, no obvious render corruption."* `MAJOR_DIFF` → FAIL.
- Golden: `tests/golden/hello-dali.png`  — **auto-baseline on first run** (does not exist yet; §G "Baseline 자동 생성": if the vision verdict is `NO_GOLDEN_BUT_LOOKS_RIGHT`, copy this PNG there and queue ✋; if `MAJOR_DIFF`, do NOT create the baseline and FAIL).
- ✋: **yes** — first render, no golden exists, and the output is software-GL-rendered DALi (GPU-class canvas) where pixel-diff is unreliable (execution-tests.md §G option ③ rationale + "조합 권고: GPU 의존 캔버스 → ③ 우선"). The orchestrator Reads the PNG, judges "looks right?", auto-registers the baseline, and queues it in `docs/autoplan/m0/visual-holds.md` for human sign-off.
- Pre-conditions: F0.1 build green; F0.2 sample present; **docker daemon reachable by this user** (`docker info` succeeds — project-profile.md `infra_gaps` "Docker 접근 권한") **and** the runtime image `ghcr.io/lwc0917/dali-preview-runtime:latest` pulled/present locally (confirmed: 1.19GB). If docker/image absent → this is a hard FAIL gate for F0.3/F0.4 (execution-tests.md §E "binary 빌드 실패 → FAIL gate" analogue: the render path cannot degrade to a lower tier because the whole feature *is* the render).

---

## F0.4 — Minimal tree emission (JSON on stdout)
- Tier: **2**  (execution-tests.md §E Tier 2 "Subprocess + stdout regex" — the PRIMARY tier for this project: stdout JSON is the contract, Inv-6. The same run that renders also prints a minimal JSON tree to stdout; we capture stdout, parse it as JSON with `node -e`, and assert ≥ per-node concrete **type** + **nesting** — exactly the F0.4 acceptance.)
- Command:
  ```bash
  OUT=/tmp/m0-f0.4-preview.png
  rm -f "$OUT"
  node out/cli.js samples/hello-dali.preview.dali.cpp --image "$OUT" > /tmp/m0-tree.json 2>/tmp/m0-tree.err
  echo "exit=$?"
  # stdout must be parseable JSON whose tree carries a concrete per-node type AND nesting (children):
  node -e '
    const fs = require("fs");
    const txt = fs.readFileSync("/tmp/m0-tree.json", "utf8").trim();
    const tree = JSON.parse(txt);                       // throws -> non-zero -> FAIL if stdout is not JSON
    const root = Array.isArray(tree) ? tree[0] : (tree.root ?? tree.tree ?? tree);
    const typeKey = ["type","typeName","className"].find(k => root && typeof root[k] === "string" && root[k].length);
    const kidsKey = ["children","nodes"].find(k => root && Array.isArray(root[k]));
    if (!typeKey) { console.error("no concrete per-node type field"); process.exit(1); }
    if (!kidsKey || root[kidsKey].length < 1) { console.error("no nesting / no children"); process.exit(1); }
    const child = root[kidsKey][0];
    const childType = ["type","typeName","className"].find(k => child && typeof child[k] === "string" && child[k].length);
    if (!childType) { console.error("child has no concrete type"); process.exit(1); }
    console.log("tree ok: root type =", root[typeKey], "| children =", root[kidsKey].length);
  '
  ```
  Timeout: 90s (shares the render; warm ccache makes reruns fast).
- Pass condition: CLI exits 0; **stdout is valid JSON** (parses without throwing); the tree's root node has a non-empty string **type/typeName/className** field AND a non-empty **children/nodes** array, and the first child also carries a concrete type (proves "per-node concrete type + nesting" for ≥2 levels). `node -e` block exits 0.
- Golden: n/a (text/JSON contract; the PNG's visual baseline is owned by F0.3).
- ✋: no — JSON shape is deterministically auto-assertable.
- Pre-conditions: identical to F0.3 (docker + runtime image; F0.1/F0.2 green). Runs as the SAME invocation as F0.3 (one command emits both PNG and tree) — kept as a separate test block only to assert the stdout contract independently of the PNG.

---

## F0.5 — ⚠️ A11y-bridge spike + decision record (ADR-008)
- Tier: **3**  (SPIKE. Its deliverable is a *captured empirical artifact + a written verdict*, not a runtime behavior, so it cannot be auto-graded for semantic correctness — execution-tests.md "Recipe 누락 시" step 3 → Tier-3 artifact-existence, **plus** a ✋ for the human to confirm the ADR's yes/no actually matches what the captured output shows. Per the task constraint "if a feature can't be fully auto-tested, add ✋ AND a Tier-3 artifact-existence fallback," both are present.)
- Command:
  ```bash
  ART=docs/autoplan/m0/spike-dumptree-output.txt
  ADR=docs/autoplan/adr/ADR-008-a11y-spike-result.md
  # 1. Both artifacts exist and are non-empty:
  test -s "$ART"
  test -s "$ADR"
  # 2. The captured artifact shows the spike was actually run headless (DumpTree output OR the bridge/D-Bus error):
  grep -Eqi 'dumptree|d-?bus|dbus|atspi|at-spi|accessib|bridge|reconstruct' "$ART"
  # 3. The ADR records a DEFINITE yes/no verdict AND the chosen tree-source path:
  grep -Eqi 'headless|d-?bus|without a (live )?d-?bus' "$ADR"
  grep -Eqi '\b(yes|no|works|does not work|unavailable|available|absent|present)\b' "$ADR"
  grep -Eqi 'property[- ]?reconstruct|reconstructed walk|DumpTree|tree[- ]?source|semanticsSource' "$ADR"
  # 4. The ADR is not a placeholder:
  ! grep -Eqi 'TBD|TODO|FIXME|\?\?\?|to be (authored|decided|determined)' "$ADR"
  echo "spike artifacts present and ADR states a verdict"
  ```
- Pass condition: BOTH `docs/autoplan/m0/spike-dumptree-output.txt` and `docs/autoplan/adr/ADR-008-a11y-spike-result.md` exist and are non-empty; the captured `.txt` mentions DumpTree / D-Bus / AT-SPI / bridge / reconstruction (evidence it was run in-container without D-Bus and the result/error was recorded); the ADR states a definite **yes/no** about whether `DumpTree` yields a semantic tree headless-without-D-Bus, names the **chosen tree-source** (property-reconstructed walk vs DumpTree-enrichment, per ADR-003/Inv-2), and contains **no placeholder** tokens. Block exits 0.
- Golden: n/a
- ✋: **yes** — the *semantic correctness* of the spike (does the ADR's verdict faithfully reflect the captured DumpTree/error output, and is the M1 tree-schema direction sound?) is a judgment the grep cannot make. Human confirms the verdict matches the artifact. (The architecture is robust either way per ADR-003/Inv-2, so this ✋ records the empirical result; it does not block M1.)
- Pre-conditions: docker + runtime image present (the spike must be RUN inside `ghcr.io/lwc0917/dali-preview-runtime:latest`, WITHOUT a live D-Bus session, to capture the real headless behavior); F0.1 build green (so the harness/CLI plumbing exists to drive the probe, though the spike may also be captured via a direct `docker run … bash -c '…DumpTree…'` one-shot). ADR-003 already fixes the structure that makes either answer safe.

---

## Coverage map (feature → tier → ✋)

| Feature | Tier | ✋ | Render needed? | Golden |
|---|---|---|---|---|
| F0.1 build + `--version` | 3 | no | no | n/a |
| F0.2 sample fixture | 3 | no | no | n/a |
| F0.3 container render + PNG | 2 (+§G ③) | **yes** | yes | tests/golden/hello-dali.png (auto) |
| F0.4 minimal JSON tree | 2 | no | yes | n/a |
| F0.5 a11y spike + ADR-008 | 3 | **yes** | yes (capture) | n/a |

Every feature has at least a Tier-3 smoke (F0.1/F0.2/F0.5 are Tier 3; F0.3/F0.4 are Tier 2, which strictly dominates a Tier-3 smoke for a CLI since §E has no Tier 1). The two features that can't be fully machine-graded (F0.3's *visual* fidelity, F0.5's *semantic* correctness) each carry a ✋ **and** a mechanical Tier-2/Tier-3 fallback assertion (PNG-magic-bytes for F0.3; artifact-existence + verdict-grep for F0.5).

---

## Self-Review

**Placeholder scan.** No `TBD`/`FIXME`/`???`/`<...>` left in any command or pass condition. The only `<bracketed>` token in the doc is inside the ADR-008 *forward reference* (the file is authored during F0.5 — by design, mirrored from architecture.md's deliberate ADR-008 forward-ref) and the generic `tests/golden/<slug>.png` template line in the header note; every concrete per-feature block names the real slug `hello-dali`. All commands are copy-pasteable as-is against this host (verified: `docker`, `file`, `node`, `python3`, `grep` all present; `jq` deliberately avoided since it is absent — JSON checks use `node -e`).

**Internal consistency.** Tiers match execution-tests.md exactly: §E gives a CLI **no Tier 1** → render fidelity is handled by §G option ③ (vision judge), not a fabricated Tier-1 pixel-diff; F0.3/F0.4 are §E Tier 2 (subprocess + stdout/artifact), the project's PRIMARY tier per Inv-6 and project-profile.md `tier2: yes`; F0.1/F0.2/F0.5 are Tier 3 (version-smoke / artifact-existence). The render contract (`docker run --rm … <image> /work/source.cpp` → exit 0 + `OK:<png>` on stdout, metadata JSON read back) is the exact sibling `dockerRuntime.buildAndCapture` + `preview_harness.cpp.template` behavior I read directly — not assumed. Inv-2 (tree-source independent of the a11y bridge) and ADR-003 are honored in F0.5's pass condition (it must name the property-reconstructed walk as the floor). The two ✋ markers (F0.3 PNG, F0.5 spike) match the task's explicit instruction ("rendered PNG → yes, since first render + no golden" and "spike can't be fully auto-tested → ✋ + Tier-3 fallback"). Visual-holds queue path (`docs/autoplan/m0/visual-holds.md`) matches execution-tests.md §G's baseline-auto-generation snippet.

**Scope check.** Exactly the five FROZEN features F0.1–F0.5 are covered — one block each, no more (no M1 schema richness, stable IDs, overlay, diffing, config flags, structured errors, or packaging, all explicitly out-of-scope per feature-checklist.md). I did **not** plan a pixel-diff golden test (would require a golden that does not exist and contradict the task + §G first-run guidance), did not invent flags beyond `--image`/`--version` (the only M0 surface in the demonstration), and did not add tests for features the milestone defers. The auto-baseline `tests/golden/hello-dali.png` is registered but only *consumed* (as a pixel golden) from M1/M4 onward — in M0 it is write-once via the vision verdict, consistent with project-profile.md `tier1: yes-after-M0`.

**Scope reality note (non-blocking).** At plan-authoring time the repo tracks only `docs/` — `package.json`, `out/cli.js`, `samples/…`, and `tests/` do not exist yet; M0 implementation creates them. Every command here is written for the post-F0.1-build state (the state in which these tests are meant to run), which is the correct frame for a test plan. This is noted so a reader running the commands *before* implementation is not surprised they fail at `out/cli.js`.

**Ambiguity → resolve or escalate.**
- *Exact stdout JSON shape (F0.4)* — M0 says "minimal" tree (rich schema is M1), so the assertion is intentionally tolerant: it accepts any of `type`/`typeName`/`className` for the type field and `children`/`nodes` for nesting, and accepts root as object, `{root}`, `{tree}`, or a top-level array. Resolved (no escalation needed): it asserts the F0.4 *contract* (concrete per-node type + nesting) without over-fitting an M0-implementer's field naming.
- *Where the spike is run (F0.5)* — could be driven through the CLI/harness or via a direct one-shot `docker run … bash -c '…DumpTree…'`. The test asserts only the two *artifacts* + a definite verdict, so it is agnostic to which path the implementer used to capture the result. Resolved.
- *Dev entry `node out/cli.js` vs the global `dali-ui-preview` bin* — used `node out/cli.js` everywhere so the suite runs without `npm link`/global install; the bin is still asserted to exist functionally via F0.1's `--version`. Resolved.

OPEN_QUESTIONS:
- none. (The single architectural open — the F0.5 empirical DumpTree-headless yes/no — is the *deliverable being tested*, not an unresolved question about the test plan; its verdict is captured by F0.5's artifacts + ✋, exactly as architecture.md OPEN_QUESTIONS intends.)
