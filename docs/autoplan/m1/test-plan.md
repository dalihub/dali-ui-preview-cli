# M1 — Test plan (canonical tree schema) — execution-based, per-feature

> Authored by the test-planner at milestone start. **Hard gate**: every feature F1.1–F1.5
> below + the unit-test suite must pass before M1 is declared done.
> Tier vocabulary = `references/execution-tests.md` (§E CLI + §G visual). This is a **CLI**
> (`project_types: [node-cli, cpp-native]`): per §E, **Tier 1 = none** for the CLI surface;
> the only pixel cross-check (golden PNG) is a §F-class framebuffer assertion reused from M0
> and is treated as an optional *visual hold*, not a gate.
>
> **Conventions for every command block below**
> - **cwd = repo root** (`/home/woochan/tizen/paperclip/dali-ui-preview`).
> - Run **`npm run build` first** (compiles `src/ → out/`). Listed once here as a global
>   pre-condition; not repeated per feature.
> - The CLI is invoked `node out/cli.js <input> [flags]`. In M1 a **bare** invocation
>   (`node out/cli.js samples/hello-dali.preview.dali.cpp`, no `--image`) prints the
>   canonical tree JSON to **stdout** (Inv-6). `--image <path>` becomes **optional**; passing
>   it must NOT change stdout. **This relaxation of the M0 "`--image` required" rule is an
>   M1 implementation pre-condition** (see Pre-conditions on F1.1).
> - **No `jq` on the host** → all JSON assertions use `node -e` reading a captured stdout file.
> - **stdout is the machine contract**: only the JSON tree (+ `--version`/`--help`) goes to
>   stdout; all diagnostics go to stderr. A passing render exits `0`.
> - A render = one `docker run --rm` against `ghcr.io/lwc0917/dali-preview-runtime:latest`
>   (present locally, 1.19 GB). Renders are slow → render-backed tiers use a **120 s timeout**
>   (overriding the §E default 30 s; the docker compile+render dominates).
> - **Golden tree (the expected node set)** for `samples/hello-dali.preview.dali.cpp`, taken
>   verbatim from the M0 DumpTree spike (`docs/autoplan/m0/spike-dumptree-output.txt`):
>
>   | path (struct id) | type | role (M1 mapped) | text/name | bounds {x,y,w,h} |
>   |---|---|---|---|---|
>   | `0` | `Layer` (RootLayer) | window | RootLayer | 0,0,1024,600 |
>   | `0/0` | `CameraActor` (DefaultCamera) | — | DefaultCamera | 512,300,0,0 |
>   | `0/1` | `FlexLayoutImpl` | (mapped, not "unknown") | — | 0,0,1024,600 |
>   | `0/1/0` | `LabelImpl` | (mapped, not "unknown") | "Hello, Dali!" | 381,262,262,56 |
>   | `0/1/1` | `LabelImpl` | (mapped, not "unknown") | (subtitle) | 339,318,346,20 |
>   | `0/2` | `CameraActor` (DefaultCamera) | — | DefaultCamera | 512,300,0,0 |
>
>   The three **load-bearing controls** the schema must enrich are the **FlexLayoutImpl** node
>   and the **two LabelImpl** nodes. (Exact structural-path strings — e.g. `0/1` vs a different
>   child-index base, and whether the two cameras are present/ordered — are an implementation
>   choice; assertions below key on **type + text + bounds**, never on a hard-coded id string,
>   except F1.3 which only checks the id is *structural-shaped* and *stable*, not its value.)
>
> **Field-name tolerance.** F1.1 (feature-checklist) mandates a per-node `bounds{x,y,w,h}`
> object. The harness/DumpTree raw form carries flat `x/y/w/h`; M1's `treeModel` is responsible
> for projecting to the canonical `bounds{...}`. Assertions therefore read **`node.bounds.{x,y,w,h}`**,
> with a documented fallback to flat `node.{x,y,w,h}` ONLY where noted, so a reviewer sees
> exactly which shape passed. `sourceLine` (F1.5) may also be named `sourceLine`; the helper
> accepts `sourceLine` first. These two tolerances are called out inline so they are auditable,
> not silent.
>
> **Shared assertion helper.** Several feature commands below reuse one inline Node snippet that
> loads the captured stdout JSON and exposes `findByType(type)` / `findByText(substr)` /
> `walk()` over the tree (children key = `children`). It is copy-pasted into each command rather
> than written to a file, so every block is self-contained and runnable as-is.

---

## Global pre-conditions (apply to ALL feature tests)

- [ ] `npm run build` exits 0 (TypeScript compiles `src/ → out/`; `out/cli.js` exists).
- [ ] Docker daemon reachable as the current user (`docker info` exits 0) **and** image
      `ghcr.io/lwc0917/dali-preview-runtime:latest` is present (`docker images` lists it). If
      `docker info` fails → render-backed tests are **SKIPPED (docker unavailable)** per the §E
      "binary build failed = FAIL gate" carve-out is NOT applied here (docker, not our build,
      is the missing dependency); record `Result: SKIPPED (docker unavailable)` and fall back to
      the Tier-3 unit suite, which needs no docker.
- [ ] `samples/hello-dali.preview.dali.cpp` exists (the bundled demo input).
- [ ] (Visual cross-check only) `tests/golden/hello-dali.png` exists, 1024×600 (verified).

---

## F1.1 — Canonical node schema

- **Tier**: **Tier 2** (exec-assert on stdout JSON — the §E primary tier for a CLI) + the
  Tier-3 unit coverage in the suite block below (every feature ≥ Tier-3 smoke via the shared
  `treeModel`/role-map unit tests).
- **Command** (copy-paste, cwd = repo root, after `npm run build`):
  ```bash
  set -o pipefail
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f11.json 2>/tmp/m1-f11.err
  echo "exit=$? stderr_bytes=$(wc -c </tmp/m1-f11.err)"
  node -e '
    const fs=require("fs");
    const root=JSON.parse(fs.readFileSync("/tmp/m1-f11.json","utf8"));
    // --- shared helper: walk + find ---
    const all=[]; (function w(n){ if(!n||typeof n!=="object")return; all.push(n); (n.children||[]).forEach(w); })(root);
    const byType=t=>all.filter(n=>n.type===t);
    const byText=s=>all.filter(n=>typeof n.text==="string"&&n.text.includes(s)
                              || typeof n.name==="string"&&n.name.includes(s)
                              || (n.value&&String(n.value).includes(s)));
    const b=n=>n.bounds&&typeof n.bounds==="object"?n.bounds:n; // tolerate flat x/y/w/h
    const fails=[];
    const need=(c,m)=>{ if(!c) fails.push(m); };
    // 1. expected node SET is present (by concrete type)
    need(byType("FlexLayoutImpl").length>=1,"missing FlexLayoutImpl node");
    need(byType("LabelImpl").length>=2,"expected >=2 LabelImpl nodes, got "+byType("LabelImpl").length);
    need(byText("Hello, Dali!").length>=1,"missing the \"Hello, Dali!\" label by text");
    // 2. root carries a concrete type (never name-only)
    need(typeof root.type==="string"&&root.type.length>0,"root has no concrete type");
    // 3. the 3 load-bearing controls each satisfy the canonical schema
    const controls=[byType("FlexLayoutImpl")[0], ...byType("LabelImpl").slice(0,2)].filter(Boolean);
    need(controls.length===3,"could not locate all 3 load-bearing controls");
    for(const n of controls){
      const tag=n.type+(n.text?(" \""+n.text+"\""):"");
      need(typeof n.id==="string"&&n.id.length>0, tag+": missing non-empty id");
      need(typeof n.type==="string"&&n.type.length>0, tag+": missing concrete type");
      need(typeof n.role==="string"&&n.role.length>0&&n.role!=="unknown", tag+": role missing or still \"unknown\" (control-type->role map not applied)");
      const bb=b(n);
      need(bb&&["x","y","w","h"].every(k=>typeof bb[k]==="number"), tag+": bounds{x,y,w,h} not all numeric");
    }
    // 4. children nesting: the FlexLayout must own the two labels as descendants
    const flex=byType("FlexLayoutImpl")[0];
    const flexLabels=[]; (function w(n){ if(!n||typeof n!=="object")return; if(n.type==="LabelImpl")flexLabels.push(n); (n.children||[]).forEach(w); })(flex);
    need(flexLabels.length>=2,"FlexLayout does not nest the two Label nodes as children");
    // 5. semanticsSource is recorded (dumptree | reconstructed) somewhere (root or metadata)
    const ss = root.semanticsSource || (root.metadata&&root.metadata.semanticsSource);
    need(ss==="dumptree"||ss==="reconstructed"||ss==="bridge", "semanticsSource not recorded as dumptree|reconstructed");
    if(fails.length){ console.error("FAIL:\n - "+fails.join("\n - ")); process.exit(1); }
    console.log("PASS F1.1: schema {id,type,role,bounds{x,y,w,h},children} present on Flex+2 Labels; node set matches; semanticsSource="+ss);
  '
  ```
- **Pass condition**: the `node -e` block prints `PASS F1.1 …` and exits 0; the first line
  shows `exit=0`. Concretely: FlexLayoutImpl + ≥2 LabelImpl present; the "Hello, Dali!" label
  found by `text`; each of the 3 controls has non-empty `id`, concrete `type`, a `role` that is
  **not** `"unknown"`, numeric `bounds.{x,y,w,h}`; the two labels nest under the FlexLayout; and
  `semanticsSource ∈ {dumptree, reconstructed, bridge}` is recorded.
- **Golden**: the node-set table above (FlexLayoutImpl, 2×LabelImpl with the "Hello, Dali!"
  text). No golden file — asserted structurally against the M0 spike's expected types/text.
- **✋**: none.
- **Pre-conditions**: global pre-conditions. **Plus the M1 implementation pre-condition**:
  `--image` is now optional and a bare `node out/cli.js <input>` prints the JSON tree to stdout
  (the M0 code makes `--image` required and would exit 1 with `missing required --image`; M1's
  `cli.ts` must relax this before this command can pass). If the impl still requires `--image`
  during early M1 iterations, append `--image /tmp/m1.png` to the invocation as a temporary
  bridge — the stdout JSON contract is unaffected — and record that the bare-invocation
  pre-condition is still pending.

---

## F1.2 — Frame-accurate bounds

- **Tier**: **Tier 2** (exec-assert on stdout JSON). Optional **visual hold** cross-check
  against `tests/golden/hello-dali.png` (§F/§G) — see Golden below; not a gate.
- **Command** (copy-paste, cwd = repo root, after `npm run build`):
  ```bash
  set -o pipefail
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f12.json 2>/dev/null
  node -e '
    const fs=require("fs");
    const root=JSON.parse(fs.readFileSync("/tmp/m1-f12.json","utf8"));
    const all=[]; (function w(n){ if(!n||typeof n!=="object")return; all.push(n); (n.children||[]).forEach(w); })(root);
    const b=n=>n.bounds&&typeof n.bounds==="object"?n.bounds:n; // tolerate flat x/y/w/h
    // locate the "Hello, Dali!" label by its text/name (NOT by id/index)
    const label=all.find(n=>n.type==="LabelImpl" &&
        ((typeof n.text==="string"&&n.text.includes("Hello, Dali!"))||
         (typeof n.name==="string"&&n.name.includes("Hello, Dali!"))));
    if(!label){ console.error("FAIL: could not find the \"Hello, Dali!\" LabelImpl node"); process.exit(1); }
    const bb=b(label);
    const exp={x:381,y:262,w:262,h:56}, tol=8;
    const off={}; let ok=true;
    for(const k of ["x","y","w","h"]){
      if(typeof bb[k]!=="number"){ console.error("FAIL: bounds."+k+" is not numeric"); process.exit(1); }
      off[k]=Math.abs(bb[k]-exp[k]); if(off[k]>tol) ok=false;
    }
    // sanity: bounds are real screen extents, not zeros/garbage
    if(bb.w<=0||bb.h<=0){ console.error("FAIL: label has non-positive size (zeros/garbage), got "+JSON.stringify(bb)); process.exit(1); }
    console.log("got="+JSON.stringify({x:bb.x,y:bb.y,w:bb.w,h:bb.h})+" exp="+JSON.stringify(exp)+" |delta|="+JSON.stringify(off)+" tol=±"+tol);
    if(!ok){ console.error("FAIL F1.2: a bound exceeds ±"+tol+"px tolerance"); process.exit(1); }
    console.log("PASS F1.2: \"Hello, Dali!\" bounds within ±"+tol+"px of frame extents {381,262,262,56}");
  '
  ```
- **Pass condition**: prints `PASS F1.2 …` and exits 0. The "Hello, Dali!" label's
  `bounds.{x,y,w,h}` are within **±8 px** of `{x:381, y:262, w:262, h:56}` (the M0 spike's
  rendered extents) AND `w>0 && h>0` (real extents, not zeros/garbage).
- **Golden**: numeric extents `{381,262,262,56}` from the M0 DumpTree spike (same render path).
  *Optional visual hold*: the reported box should land on the centered title text in
  `tests/golden/hello-dali.png` (1024×600). Cross-check via §G option ③ (Read the golden PNG
  and confirm a ~262×56 text block sits centered near y≈262); if performed, record
  EQUIVALENT/MINOR_DIFF in `exec-validation.md`. Does **not** gate F1.2 — the numeric tolerance
  assertion is the gate.
- **✋**: 1 (the optional golden-PNG visual cross-check above, if exercised, is an LLM-vision
  judgement → goes to `visual-holds.md` for user confirmation; the Tier-2 numeric assertion
  stands on its own without it).
- **Pre-conditions**: global pre-conditions + the F1.1 bare-invocation pre-condition.

---

## F1.3 — Stable IDs across runs

- **Tier**: **Tier 2** (exec-assert; two renders + id-set comparison + structural-shape check;
  plus an optional content-edit invariance sub-check).
- **Command** (copy-paste, cwd = repo root, after `npm run build`):
  ```bash
  set -o pipefail
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f13-a.json 2>/dev/null
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f13-b.json 2>/dev/null
  node -e '
    const fs=require("fs");
    const ids=p=>{const r=JSON.parse(fs.readFileSync(p,"utf8"));const out=[];
      (function w(n){ if(!n||typeof n!=="object")return; if(typeof n.id==="string")out.push(n.id); (n.children||[]).forEach(w); })(r);
      return out;};
    const A=ids("/tmp/m1-f13-a.json"), B=ids("/tmp/m1-f13-b.json");
    const fails=[];
    if(A.length===0) fails.push("no node carried an id");
    // 1. id SETS identical across the two runs (order-independent)
    const sA=[...new Set(A)].sort(), sB=[...new Set(B)].sort();
    if(JSON.stringify(sA)!==JSON.stringify(sB)) fails.push("id set differs across runs:\n  A="+JSON.stringify(sA)+"\n  B="+JSON.stringify(sB));
    // 2. ids are STRUCTURAL (child-index path like 0, 0/1, 0/1/0) — NOT a hex address / pointer / GetId counter
    const structural=/^[0-9]+(\/[0-9]+)*$/;
    const hexish=/0x[0-9a-fA-F]+|@[0-9a-fA-F]{4,}/;
    const bad=A.filter(id=>!structural.test(id)||hexish.test(id));
    if(bad.length) fails.push("ids are not structural-path shaped (or look like addresses): "+JSON.stringify([...new Set(bad)].slice(0,5)));
    // 3. ids are UNIQUE within a run (path identity must distinguish siblings)
    if(new Set(A).size!==A.length) fails.push("ids are not unique within a run (duplicate paths)");
    if(fails.length){ console.error("FAIL F1.3:\n - "+fails.join("\n - ")); process.exit(1); }
    console.log("PASS F1.3: "+A.length+" ids, identical set across 2 runs, structural-path shaped, unique. e.g. "+JSON.stringify(sA.slice(0,6)));
  '
  ```
- **Optional sub-check — id survives a content edit (Inv-8 / F1.3 second clause)**:
  ```bash
  set -o pipefail
  TMP=$(mktemp -d)
  cp samples/hello-dali.preview.dali.cpp "$TMP/edited.preview.dali.cpp"
  # change ONLY the label text ("Hello, Dali!" -> "Hi there!"); structure unchanged
  node -e 'const fs=require("fs");const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("Hello, Dali!","Hi there!"));' "$TMP/edited.preview.dali.cpp"
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f13-orig.json 2>/dev/null
  node out/cli.js "$TMP/edited.preview.dali.cpp"           1>/tmp/m1-f13-edit.json 2>/dev/null
  node -e '
    const fs=require("fs");
    const ids=p=>{const r=JSON.parse(fs.readFileSync(p,"utf8"));const out=[];
      (function w(n){ if(!n||typeof n!=="object")return; if(typeof n.id==="string")out.push(n.id); (n.children||[]).forEach(w); })(r);
      return [...new Set(out)].sort();};
    const O=ids("/tmp/m1-f13-orig.json"), E=ids("/tmp/m1-f13-edit.json");
    if(JSON.stringify(O)!==JSON.stringify(E)){
      console.error("FAIL F1.3-edit: id set changed after a text-only edit (id is NOT content-stable):\n  orig="+JSON.stringify(O)+"\n  edit="+JSON.stringify(E)); process.exit(1);
    }
    console.log("PASS F1.3-edit: id set unchanged after editing label text (Inv-8: structural id survives content edit)");
  '
  rm -rf "$TMP"
  ```
- **Pass condition**: the main block prints `PASS F1.3 …` (exit 0): ≥1 id; the **id set is
  identical** across the two runs; every id matches `^[0-9]+(/[0-9]+)*$` and contains **no**
  `0x…`/`@hex` address marker; ids are unique within a run. The optional sub-check prints
  `PASS F1.3-edit …` (exit 0): the id set is unchanged after editing only the label's text.
- **Golden**: no file. The id *shape* (structural child-index path) is the contract (ADR-004);
  exact strings are not pinned.
- **✋**: none.
- **Pre-conditions**: global pre-conditions + the F1.1 bare-invocation pre-condition. The
  sub-check additionally requires write access to `mktemp -d` (the `/tmp` working dir is an
  allowed additional working directory).

---

## F1.4 — Determinism guarantees (LOAD-BEARING)

- **Tier**: **Tier 2** (exec-assert; the byte-identical-across-two-runs check named explicitly
  in `project-profile.md` `tier2` and `Inv-3`). This is the milestone's key test.
- **Command** (copy-paste, cwd = repo root, after `npm run build`):
  ```bash
  set -o pipefail
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f14-a.json 2>/tmp/m1-f14-a.err
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f14-b.json 2>/tmp/m1-f14-b.err
  if diff -q /tmp/m1-f14-a.json /tmp/m1-f14-b.json >/dev/null; then
    echo "PASS F1.4: stdout byte-identical across 2 runs ($(wc -c </tmp/m1-f14-a.json) bytes, sha256 $(sha256sum /tmp/m1-f14-a.json | cut -c1-16))"
  else
    echo "FAIL F1.4: stdout differs between runs — unified diff (first 40 lines):"
    diff -u /tmp/m1-f14-a.json /tmp/m1-f14-b.json | head -40
    exit 1
  fi
  # belt-and-suspenders: the captured JSON must be parseable (Inv-6) and contain no raw address tokens
  node -e '
    const fs=require("fs"); const raw=fs.readFileSync("/tmp/m1-f14-a.json","utf8");
    JSON.parse(raw); // throws if stdout is not pure JSON
    const m=raw.match(/0x[0-9a-fA-F]{6,}/);
    if(m){ console.error("FAIL F1.4: stdout contains a raw address token "+m[0]+" (addresses must be stripped)"); process.exit(1); }
    console.log("PASS F1.4-aux: stdout is valid JSON with no raw address tokens");
  '
  ```
- **Pass condition**: `diff -q` reports the two stdout captures are **identical** → prints
  `PASS F1.4 …` and the script exits 0 (the byte-identical requirement: `render twice | diff`
  is **empty**). The aux block confirms the capture is valid JSON (Inv-6) and carries **no**
  `0x…` address token (Inv-3 "addresses stripped"). **Any** byte difference → FAIL, with a
  unified diff printed to pinpoint the nondeterministic field (timestamp, address, unsorted
  child, etc.).
- **Golden**: none — the test is run-A **vs** run-B self-comparison (byte equality), the
  strongest possible determinism assertion.
- **✋**: none — this is a deterministic byte comparison; no human judgement.
- **Pre-conditions**: global pre-conditions + the F1.1 bare-invocation pre-condition. Both
  runs MUST use identical flags and the same input file (byte-identical requires identical
  effective config — Inv-3). Stdout is captured separately from stderr so the eldbus/D-Bus
  headless noise (which is on **stderr** and may legitimately vary) never enters the
  comparison.

---

## F1.5 — Source-line provenance

- **Tier**: **Tier 2** (exec-assert on stdout JSON) + unit coverage (sourceLine carry in the
  `treeModel`/templater units, suite block below).
- **Command** (copy-paste, cwd = repo root, after `npm run build`):
  ```bash
  set -o pipefail
  node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m1-f15.json 2>/dev/null
  node -e '
    const fs=require("fs");
    const root=JSON.parse(fs.readFileSync("/tmp/m1-f15.json","utf8"));
    const all=[]; (function w(n){ if(!n||typeof n!=="object")return; all.push(n); (n.children||[]).forEach(w); })(root);
    const sl=n => (typeof n.sourceLine==="number")?n.sourceLine
                 :(typeof n.sourceLine==="string"&&/^[0-9]+$/.test(n.sourceLine))?Number(n.sourceLine)
                 :undefined; // accept sourceLine number or numeric string
    const labels=all.filter(n=>n.type==="LabelImpl");
    const fails=[];
    if(labels.length<2) fails.push("expected >=2 LabelImpl nodes, got "+labels.length);
    const withSL=labels.filter(n=>sl(n)!==undefined);
    if(withSL.length<1) fails.push("no LabelImpl node carries a sourceLine (provenance missing)");
    // the sample defines labels at lines 21 and 25 (1-based) of hello-dali.preview.dali.cpp;
    // accept a generous in-file range so the test is robust to 0- vs 1-based and marker offsets.
    const inRange=withSL.filter(n=>{const v=sl(n);return v>=10&&v<=40;});
    if(withSL.length>=1 && inRange.length<1)
      fails.push("LabelImpl sourceLine(s) "+JSON.stringify(withSL.map(sl))+" map outside the sample label region (~lines 21,25)");
    if(fails.length){ console.error("FAIL F1.5:\n - "+fails.join("\n - ")); process.exit(1); }
    console.log("PASS F1.5: "+withSL.length+"/"+labels.length+" Label nodes carry a sourceLine; values="+JSON.stringify(withSL.map(sl))+" (within the sample label region)");
  '
  ```
- **Pass condition**: prints `PASS F1.5 …` and exits 0. At least one `LabelImpl` node carries a
  `sourceLine` (numeric, or numeric string), and the carried line(s) fall in the sample's label
  region (lines ~21 and ~25 of `samples/hello-dali.preview.dali.cpp`; the assertion uses a
  generous `10..40` window to tolerate 0- vs 1-based indexing and any marker offset). This
  proves a caller can map a tree node back to the input line that produced it.
- **Golden**: the sample's label-defining lines —
  ```
  21:        Label::New("Hello, Dali!")
  25:        Label::New("Edit this file to see the preview update")
  ```
  (1-based, from `samples/hello-dali.preview.dali.cpp`).
- **✋**: none.
- **Pre-conditions**: global pre-conditions + the F1.1 bare-invocation pre-condition.
  Provenance depends on the harness `__tag`/`__L{line}` mechanism surviving into the metadata
  JSON and `treeModel` carrying it onto the node (architecture data-flow step 4). If the harness
  emits provenance only for a subset of nodes, the `>=1 Label carries sourceLine` floor is the
  gate (not "every node"), matching F1.5's "where derivable" wording.

---

## Unit-test suite — `npm test` (Tier 3, real tests; folded-in carry-over → Gate A)

- **Tier**: **Tier 3** (unit; mocha + c8). Becomes a real **Gate A** (`npm test` must run
  GREEN), replacing the M0 placeholder. Every M1 feature thus has ≥ Tier-3 coverage here in
  addition to its Tier-2 exec-assert above.
- **Command** (copy-paste, cwd = repo root):
  ```bash
  npm run build && npm test; echo "test_exit=$?"
  ```
- **Required real tests** (new files under `src/test/unit/*.test.ts` → compiled to
  `out/test/unit/*.test.js`; the `npm test` glob is `out/test/unit/**/*.test.js`, c8+mocha,
  10 s timeout). These exercise the **pure** modules with **no docker** (fast, deterministic),
  feeding each a representative metadata JSON fixture (the M0 spike JSON is the canonical
  fixture):
  - **`treeModel`** — given the M0 spike metadata JSON (or its `{root:…}` wrapper), `buildTree`
    yields a tree where: the FlexLayout + both Labels are present with concrete `type`; each
    canonical node exposes `id`, `role`, `bounds{x,y,w,h}`, `children`; the root carries a
    concrete `type` (never name-only); `semanticsSource` is recorded. Malformed/empty/non-JSON
    input throws the documented errors (existing M0 behaviour must not regress).
  - **`harnessTemplater`** — every `{{PLACEHOLDER}}` is substituted (output contains no
    `{{…}}`); `{{USER_CODE}}` is inserted **verbatim** (Inv-5 faithful render); a leftover
    placeholder throws; width/height emit as `<n>.0f` float literals.
  - **`inputResolver`** — preview-file mode returns the whole body with `startLine 0`; marker
    mode extracts the region between `@dali-preview-begin`/`@dali-preview-end` with the correct
    `startLine`; unsupported extension / missing markers / unreadable file throw.
  - **id + role logic** (the new M1 pure module(s) — structural-path id builder and
    control-type→role map): the id builder produces deterministic child-index paths
    (`0`, `0/1`, `0/1/0`) for a sample tree and is a **pure function of structure** (same input
    → same ids; a content-only change → same ids — Inv-8); the role map turns
    `LabelImpl/FlexLayoutImpl/Button/Image/Layer` into concrete roles (never `"unknown"`),
    with an explicit fallback (e.g. `"unknown"`/`"generic"`) for unmapped types.
- **Pass condition**: `npm run build` exits 0, then `npm test` exits 0 with mocha reporting
  **all tests passing and zero failing** (`test_exit=0`); the run includes real tests for
  `treeModel`, `harnessTemplater`, `inputResolver`, and the id+role logic (not an empty/skip
  suite). c8 prints a coverage table (coverage % is informational, not a gate in M1).
- **Golden**: the M0 spike JSON (`docs/autoplan/m0/spike-dumptree-output.txt`) is the canonical
  in-repo fixture for the `treeModel`/id/role tests (it is the real tree for the sample); tests
  may inline a trimmed copy.
- **✋**: none.
- **Pre-conditions**: `mocha` + `c8` present in `node_modules/.bin` (verified). `tsconfig.json`
  already includes `src/**/*.ts` with `rootDir: src`, so `src/test/unit/*.test.ts` compiles to
  `out/test/unit/*.test.js` (no tsconfig change needed). These unit tests must NOT spawn docker
  (Gate A stays fast and host-independent); the docker path is exercised only by the Tier-2
  feature commands above.

---

## Tier distribution (summary)

| Feature | Tier 1 | Tier 2 | Tier 3 | Visual hold |
|---|---|---|---|---|
| F1.1 canonical schema | — | ✅ (exec-assert) | ✅ (unit) | — |
| F1.2 frame-accurate bounds | — | ✅ (exec-assert) | — | ① optional golden PNG |
| F1.3 stable ids | — | ✅ (exec-assert ×2 + edit) | — | — |
| F1.4 determinism (load-bearing) | — | ✅ (byte-identical diff) | — | — |
| F1.5 source-line provenance | — | ✅ (exec-assert) | ✅ (unit) | — |
| Unit suite (`npm test`) | — | — | ✅ (Gate A) | — |

Tier 1 (golden-PNG pixel diff) is intentionally **not a per-feature gate** for this CLI: per
`references/execution-tests.md` §E, a CLI has no Tier-1, and per §G the only pixel surface
(`tests/golden/hello-dali.png`) is reused as an **optional visual hold** cross-check for F1.2
bounds, not as a determinism/schema gate (those are Tier-2 stdout assertions, which are exact).

---

## Self-Review

- **Placeholder scan**: No `TBD`/`FIXME`/`???`/`<...>`-stub left in any command. Every assertion
  command is concrete and copy-paste runnable from the repo root after `npm run build`: real
  file paths (`samples/hello-dali.preview.dali.cpp`, `tests/golden/hello-dali.png`,
  `/tmp/m1-f1*.json`), real tools (`node -e`, `diff`, `sha256sum`, `npm test` with the actual
  `c8 mocha out/test/unit/**/*.test.js` script verified in `package.json`). No invented flags
  (only the real `--image`, `--version`, `--help`, and the bare positional input). The one
  forward-looking dependency — `--image` becoming optional / bare invocation printing the tree —
  is explicitly flagged as an **M1 implementation pre-condition** (not assumed silently) with a
  concrete temporary bridge (`append --image /tmp/m1.png`) so the plan is runnable even
  mid-implementation.
- **Internal consistency**: Tiers match `execution-tests.md` (§E CLI: no Tier-1; Tier-2 stdout
  assert primary; Tier-3 unit) and `project-profile.md` `exec_test_tiers_available`. F1.4's
  byte-identical `diff` is exactly the `Inv-3` / `project-profile.tier2` "render twice | diff ==
  empty" recipe. Field names match the codebase + ADRs: `children` (treeModel), `id` as
  structural path (ADR-004), `role` from a control-type map replacing DumpTree `"unknown"`
  (ADR-008), `bounds{x,y,w,h}` (F1.1 wording) with a documented flat-`x/y/w/h` fallback
  (the M0 spike + current `treeModel` shape), `semanticsSource` (ADR-003/architecture),
  `sourceLine` (ADR-004/F1.5). The golden node-set table is taken verbatim from the M0 spike
  output, so the expected types/text/bounds are real, not guessed. The 1024×600 golden dims and
  mocha/c8 presence were verified against the live tree, not assumed.
- **Scope check**: Exactly the five frozen features F1.1–F1.5 + the folded-in unit-test
  carry-over are covered — one block each, no more. Nothing from M2+ is tested (no overlay /
  Set-of-Mark, no box-tree/report/token-caps/watch, no image-diff/tree-diff/verdict, no
  `--theme/--resolution/--dpr`, no packaging) — the golden PNG appears only as an *optional*
  F1.2 bounds cross-check, not as an M2 overlay test. The id-survives-edit sub-check touches
  Inv-8 but is scoped as a *property of F1.3's stable id* (F1.3's own second clause), not as the
  M4 tree-diff feature (which is not exercised here). Assertions deliberately key on
  type/text/bounds, never on a hard-coded structural-id string, so a legitimate
  implementation choice of base index or camera handling does not falsely fail.
- **Ambiguity → resolved or surfaced**:
  - *bounds shape* (`bounds{x,y,w,h}` object per F1.1 vs flat `x/y/w/h` from DumpTree/M0
    `treeModel`) → **resolved** by a helper that prefers `node.bounds` and falls back to flat,
    with the fallback called out inline so a reviewer sees which shape passed. M1 should settle
    on `bounds{…}`; the test does not block on the projection detail.
  - *sourceLine type* (number vs numeric string) and *which* nodes carry it → **resolved**:
    accept both types; gate on "≥1 Label carries it within the in-file region", matching F1.5's
    "where derivable" wording rather than over-demanding every node.
  - *exact structural-id strings / camera presence+ordering* → **deliberately not pinned**
    (implementation choice per ADR-004); F1.3 asserts only shape+stability+uniqueness.
  - *docker availability* → **surfaced**: a documented `SKIPPED (docker unavailable)` fallback
    to the no-docker Tier-3 unit suite, so the plan degrades gracefully on a docker-less host
    (per `execution-tests.md` graceful-skip semantics) rather than hard-failing.

  **OPEN_QUESTIONS**: none blocking. The single coordination item — M1 `cli.ts` must make
  `--image` optional so the bare invocation prints the tree to stdout (Inv-6) — is recorded as
  an explicit pre-condition on F1.1 with a temporary bridge, so no test is blocked on it.
