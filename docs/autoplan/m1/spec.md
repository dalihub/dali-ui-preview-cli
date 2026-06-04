# M1 — Canonical tree schema — implementation spec

> Authored by the spec-drafting agent at milestone start, AFTER the frozen
> `feature-checklist.md` (F1.1–F1.5 + folded carry-over) and `test-plan.md`
> (tiers + exact assertions). Encodes the M1 design decisions from
> `architecture.md` (Inv-1..8) and `adr/ADR-003` (tree source), `adr/ADR-004`
> (stable-id strategy), `adr/ADR-008` (DumpTree works headless → MERGE it).
> These decisions are DECIDED — the work units below ENCODE them, they do not
> re-litigate them.
>
> **API confirmed against the live runtime image** `ghcr.io/lwc0917/dali-preview-runtime:latest`
> (DALi prefix `/opt/dali/include`, `pkg-config --cflags dali2-toolkit`):
> - `Dali::DevelActor::CalculateCurrentScreenExtents(Actor)` → `Rect<>`
>   — header `dali/devel-api/actors/actor-devel.h:381`. Frame-accurate `{x,y,w,h}`.
> - `Dali::Accessibility::Accessible::Get(Dali::Actor)` → `Accessible*`
>   and `->DumpTree(Accessibility::Accessible::DumpDetailLevel::DUMP_FULL)` → `std::string`
>   — header `dali/devel-api/atspi-interfaces/accessible.h:305` (enum `DUMP_FULL = 2`).
>   Returns the JSON we saw in the M0 spike (`docs/autoplan/m0/spike-dumptree-output.txt`):
>   per-node `{ role, states, text, type, x, y, w, h, path, attributes, children[] }`,
>   children in actor child-index order (same order as `Actor::GetChildAt(i)`).

---

## 1. Goal

On the bundled sample, **`node out/cli.js samples/hello-dali.preview.dali.cpp`** (no
`--image`) prints a complete, **deterministic** JSON tree to **stdout** where every node
carries:

- a **stable id** — the node's structural path (child-index chain, e.g. `"0/1/0"`),
  assigned in the harness's single C++ DFS (ADR-004 / Inv-1), **not** a memory address,
  **not** the process-local `GetId()`;
- a concrete **type** (never name-only; typed default `Actor`/`Layer` when `GetTypeName()` is empty);
- a semantic **role** — sourced from DumpTree (ADR-008) and run through a **control-type → role map**
  that replaces DumpTree's default `"unknown"`/`"redundant object"` roles for the common controls;
- **frame-accurate bounds** `{x,y,w,h}` from the render-frame screen extents
  (`DevelActor::CalculateCurrentScreenExtents`, cross-checked against DumpTree's x/y/w/h),
  **not** the hand-rolled parentOrigin/anchor math;
- a **sourceLine** provenance field where derivable (parsed off the `__L{line}` NAME tag
  and/or the `cppParser` sourceLine map);
- `children` in a stable sorted order, with addresses/pointers stripped and floats formatted
  deterministically → **two consecutive dumps are byte-identical** (F1.4 / Inv-3).

`semanticsSource` (`"dumptree"` | `"reconstructed"`) is recorded so a reviewer can audit which
path produced the semantics. `--image <path>` becomes **optional** (Inv-6): passing it writes the
PNG but must NOT change stdout. A real **mocha+c8 unit suite** under `src/test/unit/` runs GREEN
under `npm test` (Gate A), using the M0 spike JSON as a no-docker fixture.

This is the **demonstration** from the frozen checklist verbatim: a deterministic JSON tree with
concrete type + semantic role + frame-accurate bounds + stable id, byte-identical across two runs.

---

## 2. Out of scope (deferred — do NOT build in M1)

| Deferred item | Milestone |
|---|---|
| Image overlay / **Set-of-Mark** visuals (numbered marks drawn on PNG). The `mark` ordinal id strategy is decided by ADR-004 but **only the structural `id` lands in M1**; the overlay/`mark` rendering is M2. | **M2** |
| Box-drawing **tree formatter**, **HTML/MD report**, **token caps** (`--max-depth`/`--max-nodes`), **watch** mode. | **M3** |
| **Image-diff** / **tree-diff** / **verdict** / `--update-baseline`. (Inv-8 "id survives content edit" is *exercised as a property of F1.3's stable id* — the optional F1.3 sub-check — NOT as the M4 tree-diff feature.) | **M4** |
| **Config flags** `--theme` / `--resolution` / `--dpr`, **structured-error contract**, eldbus/D-Bus **stderr filtering**. | **M5** |
| **Packaging** (`npx` publish, GHCR pull-by-tag UX). | **M6** |

New features discovered mid-M1 → `docs/autoplan/m1/oos-queue.md` (do NOT fold into these WUs).

---

## 3. Work units

Single-threaded, strictly ordered for sequential validation. The natural split is:
**(WU-1) harness DFS rewrite** [structural ids + screen-extents bounds + DumpTree merge + role map +
determinism, all inside the one C++ walk] → **(WU-2) TS canonical `treeModel`** [consume the enriched
metadata: project `bounds{…}`, carry id/role/sourceLine/semanticsSource, keep M0 error behaviour] →
**(WU-3) `cli.ts` `--image` optional** [bare invocation prints the tree] → **(WU-4) unit-test suite**
[mocha+c8, M0-spike fixture, Gate A]. WU-1 is the load-bearing change; WU-2..4 consume it.

> **Tier vocabulary**: per `test-plan.md`, this is a CLI (`node-cli`, `cpp-native`): **Tier 1 = none**
> for the CLI surface. Every WU below is **≥ Tier 3** (the per-feature exec-assert is Tier 2; the unit
> suite is Tier 3 Gate A). Assertion commands are **cited verbatim** from `test-plan.md` — not
> regenerated. The global pre-conditions (`npm run build` exits 0; docker reachable + image present
> for render-backed Tier-2; bare-invocation pre-condition) apply to every render-backed assertion;
> if `docker info` fails, render-backed Tier-2 assertions record `SKIPPED (docker unavailable)` and
> the Tier-3 unit suite (no docker) is the standing gate (per `test-plan.md` global pre-conditions).

---

### WU-1 — Harness single-DFS rewrite: structural ids + screen-extents bounds + DumpTree merge + role map + determinism

**Encodes**: ADR-004 (structural-path id in the one C++ DFS), F1.2 (`CalculateCurrentScreenExtents`
bounds), ADR-008 + ADR-003 (DumpTree merge + control-type→role map, property-walk as the floor),
F1.4/Inv-3 (sorted children, stripped addresses, deterministic floats), F1.5 (carry `__L{line}` → sourceLine).

**Files to touch (concrete)**:
- `server/preview_harness.cpp.template` — the M0 tree exporter. Specifically:
  - Add includes: `#include <dali/devel-api/actors/actor-devel.h>` (for
    `DevelActor::CalculateCurrentScreenExtents`) and
    `#include <dali/devel-api/atspi-interfaces/accessible.h>` (for `Accessibility::Accessible`).
    Confirmed present at `/opt/dali/include/...` in the runtime image (see header note above).
  - **Bounds (F1.2)**: replace the hand-rolled parentOrigin/anchor math in `CollectActorMetadata`
    (lines ~126–135: `pos`/`anchor`/`parentOrigin` → `x`/`y`) with
    `Dali::Rect<> ext = Dali::DevelActor::CalculateCurrentScreenExtents(actor);` and emit
    `ext.x/ext.y/ext.width/ext.height`. Drop the now-dead `pX,pY,pW,pH` accumulation parameters
    (and the `localX`/`localY` fields — superseded; the box is now absolute frame extents).
  - **Stable id (ADR-004 / Inv-1)**: thread a `const std::string& path` parameter through the DFS.
    The root child loop starts ids at the root's own path; each node emits `"id":"<path>"` and
    recurses with `path + "/" + std::to_string(i)` for child `i`. Root = `"0"` (the synthetic
    RootLayer node in `ExportSceneMetadata`); its `k`-th child = `"0/k"`; grandchild = `"0/k/j"`.
    Ids are the structural path ONLY — **separate** from the NAME field (which still carries the
    `__L{line}` tag) and **never** `GetId()` or a pointer.
  - **DumpTree merge (ADR-008 / F1.1)**: in `ExportSceneMetadata` (once, before the walk), call
    `Accessibility::Accessible* a = Accessibility::Accessible::Get(root);` and
    `std::string dump = a ? a->DumpTree(Accessibility::Accessible::DumpDetailLevel::DUMP_FULL) : "";`.
    Parse that JSON (a minimal in-harness extractor is sufficient — the format is the fixed shape in
    the M0 spike) into a parallel tree keyed by **child-index order** (DumpTree's `children[]` order
    equals `Actor::GetChildAt(i)` order). During the property-walk DFS, look up the matching DumpTree
    node by the same child-index path and lift its `role`, `states`, and `text` (name) onto the
    per-node record. If `Accessible::Get` returns null or the dump is empty/unparseable, skip the
    enrichment — the property-walk values stand (Inv-2 floor).
  - **control-type → role map (ADR-008)**: a static C++ table mapping the concrete control type to a
    canonical role, applied to override DumpTree's default `"unknown"`/`"redundant object"`:
    `LabelImpl → "label"`, `FlexLayoutImpl → "container"` (use `"filler"` for a flex child slot per
    ADR-008's note), `Layer → "window"` for the root / `"panel"` for nested layers,
    `CameraActor → ` omit-or-`"redundant"` (keep the node but mark its role `"redundant"`; do NOT
    invent geometry — its DumpTree `w/h` are `0`), `Button → "push button"`, `ImageView → "image"`.
    Unmapped types fall back to the DumpTree role if it is meaningful, else `"unknown"`.
  - **`semanticsSource`**: emit `"semanticsSource":"dumptree"` at the document root (inside
    `ExportSceneMetadata`'s wrapper) when the DumpTree enrichment ran and produced ≥1 role;
    `"reconstructed"` when it was skipped (Inv-2 floor / ADR-003 auditability).
  - **sourceLine (F1.5)**: the NAME already carries `__L{line}` from `__tag`. Emit a numeric
    `"sourceLine":<n>` field per node by parsing the integer out of a `__L` NAME prefix when present
    (leave the field absent when the actor has no `__L` tag — F1.5 is "where derivable"). Keep the
    raw `name` field too (the human label is reconstructed in TS / later; do not blindly trust NAME).
  - **Determinism (F1.4 / Inv-3)**: (a) walk children in `GetChildAt(0..n-1)` index order (already
    stable — assert no re-sort by address); (b) strip ALL addresses/pointers — emit no `GetId()`, no
    pointer, no `path:"/org/a11y/.../N"` (the DumpTree atspi path is a per-run accessible-object
    counter → MUST NOT leak into output); (c) format floats deterministically — set a fixed,
    locale-independent format on the `std::ostringstream` (e.g. `json << std::fixed <<
    std::setprecision(N)` with a stable N, applied to every numeric emit) so `1024` and `262.0`
    serialize identically run-to-run. Add `#include <iomanip>` for the formatting manipulators.
- `src/treeModel.ts` — **no change in WU-1** (its consumption is WU-2). Listed only so the contract
  the harness now emits (`id`, `role`, `sourceLine`, `semanticsSource`, screen-extent `x/y/w/h`) is
  understood as the input WU-2 will project.

**Acceptance (user view)**: after `npm run build`, a bare render of the sample emits a JSON tree
whose FlexLayout + two Labels each carry a non-empty structural-path `id`, a `role` that is **not**
`"unknown"`, and numeric `x/y/w/h` matching the rendered frame (the "Hello, Dali!" label at
≈`{381,262,262,56}`); `semanticsSource` is recorded; two consecutive renders are byte-identical.
(The harness produces these fields; WU-2/WU-3 surface them on stdout — so the Tier-2 commands below
are run against the WU-1+WU-2+WU-3 stack, with WU-1 being the field-producing change.)

**Features**: F1.1 (role + concrete type + semanticsSource), F1.2 (bounds), F1.3 (structural id),
F1.4 (determinism), F1.5 (sourceLine source).

**Execution tier**: **Tier 2** (render-backed exec-assert on stdout JSON) — this WU's fields are
validated by F1.1/F1.2/F1.3/F1.4/F1.5 commands, which only pass once the full stack (WU-1→WU-3) is
in place; during WU-1 iteration, the **determinism byte-identity** check (F1.4) and the **bounds**
check (F1.2) are the primary harness-level signals. Plus the WU-4 Tier-3 unit coverage of the
extracted **id builder + role map** (those are pure functions liftable into TS — see WU-4).

EXACT cited assertion command (from `test-plan.md` **F1.2 — Frame-accurate bounds**):
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
…and the determinism gate (from `test-plan.md` **F1.4 — Determinism guarantees (LOAD-BEARING)**):
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

**✋**: 1 — the directive "Confirm the screen-extents API against the runtime image when
implementing" is satisfied at the *spec* level (header path + signature confirmed above against the
live image). The remaining ✋ is the **optional golden-PNG visual cross-check** for F1.2 (read
`tests/golden/hello-dali.png` and confirm a ~262×56 text block sits centered near y≈262) — it is an
LLM-vision judgement → `visual-holds.md`, NOT a gate (the ±8 px numeric assertion is the gate).

**Dependencies**: none (first WU; builds on the M0 harness).

---

### WU-2 — TS canonical `treeModel`: project `bounds{x,y,w,h}`, carry id/role/sourceLine/semanticsSource, keep M0 error behaviour

**Encodes**: F1.1 (canonical node schema surfaced to the caller), the `test-plan.md` field-name
tolerance (raw flat `x/y/w/h` → canonical `bounds{x,y,w,h}` object), Inv-2 (a schema-valid tree even
when `semanticsSource:"reconstructed"`), and the folded-in carry-over "stronger tree assertion".

**Files to touch (concrete)**:
- `src/treeModel.ts` — extend `buildTree` and the node interface (rename/augment `MinimalNode` →
  a `CanonicalNode` shape, keeping back-compat where the M0 tests would otherwise regress):
  - Define the canonical node interface: `{ id: string; type: string; role?: string; name?: string;
    bounds: { x:number; y:number; w:number; h:number }; sourceLine?: number; children?: CanonicalNode[];
    [k:string]: unknown }`. (`role`/`sourceLine` optional to honour Inv-2 / "where derivable".)
  - **Project bounds**: for every node, fold the harness's flat `x/y/w/h` into a `bounds:{x,y,w,h}`
    object (the `test-plan.md` "Field-name tolerance" mandate: F1.1 wants a `bounds{…}` object; the
    harness emits flat — `treeModel` is the projector). Keep the flat keys OR drop them — either is
    acceptable per the test helper's `node.bounds ?? flat` fallback; **prefer** projecting to
    `bounds{…}` and removing the flat duplicates so the canonical shape is unambiguous.
  - **Carry through** `id`, `role`, `sourceLine`, `children` unchanged from the harness record; the
    walk must recurse so EVERY node (not just the root) is projected/normalised.
  - **Concrete type guarantee (F1.1)**: keep the M0 behaviour — if a node (incl. the synthetic root)
    lacks a concrete `type`, stamp the typed default (`Layer` for the root). Never name-only.
  - **`semanticsSource`**: surface it on the returned root (read it from the harness wrapper; if the
    harness omitted it, default to `"reconstructed"` so the field is always present and auditable).
  - **Error behaviour (must NOT regress)**: keep the exact M0 throws — null/empty input →
    `'no scene metadata was produced by the render.'`; non-JSON → `'scene metadata is not valid JSON: …'`;
    non-object root → `'scene metadata has no object root node.'`. These are asserted by the WU-4 unit tests.
- `src/treeModel.ts` (same file) — if the structural-id builder and/or control-type→role map are
  ALSO needed host-side as **pure functions for the unit tests** (WU-4 requires unit coverage of "the
  id builder produces deterministic child-index paths" and "the role map turns LabelImpl/… into
  concrete roles"), extract them into a small pure module **`src/treeSchema.ts`** (new file):
  `structuralId(parentPath, childIndex): string` and `roleForType(type, dumpTreeRole?): string` with
  the explicit unmapped fallback. The harness (WU-1) is the *authoritative* assigner at render time
  (Inv-1); `treeSchema.ts` is the **same logic in TS** so it is unit-testable with no docker (and so
  a future TS-side reconstruction path stays consistent). This keeps Inv-1 intact: stdout ids come
  from the harness; `treeSchema.ts` is a tested mirror, not a second emitter in the live path.

**Acceptance (user view)**: given the harness metadata JSON (or the M0 spike fixture), `buildTree`
returns a tree where the FlexLayout + both Labels are present with concrete `type`, each node exposes
`id`, `role`, `bounds{x,y,w,h}`, `children`; the root carries a concrete `type` and
`semanticsSource`; malformed/empty/non-JSON input still throws the documented M0 errors.

**Features**: F1.1 (canonical schema), F1.2 (`bounds{…}` projection), F1.5 (sourceLine carry).

**Execution tier**: **Tier 2** (the F1.1 stdout exec-assert exercises this projection end-to-end)
**+ Tier 3** (the `treeModel`/`treeSchema` unit tests in WU-4 are the no-docker gate for this WU).

EXACT cited assertion command (from `test-plan.md` **F1.1 — Canonical node schema**):
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
…and the provenance assertion (from `test-plan.md` **F1.5 — Source-line provenance**):
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

**✋**: none.

**Dependencies**: **WU-1** (consumes the harness's new `id`/`role`/`sourceLine`/`semanticsSource`/
screen-extent fields). The F1.1/F1.5 commands additionally need WU-3 (bare invocation); during WU-2
iteration the unit tests (WU-4) are the standing signal.

---

### WU-3 — `cli.ts`: make `--image` optional (bare invocation prints the canonical tree to stdout)

**Encodes**: Inv-6 (JSON stdout is the primary contract; image is on-demand) and the `test-plan.md`
**M1 implementation pre-condition** that gates F1.1–F1.5 ("a bare `node out/cli.js <input>` prints
the JSON tree to stdout; `--image` becomes optional and passing it must NOT change stdout").

**Files to touch (concrete)**:
- `src/cli.ts`:
  - `RenderArgs.imageOut`: make optional (`imageOut?: string`).
  - `parseRenderArgs`: **remove** the `if (imageOut === undefined) throw 'missing required --image …'`
    check (lines ~84–86). Keep the duplicate-`--image` and value-validation checks. A bare
    `<input>` with no `--image` is now valid.
  - `runRender`: only copy the PNG out **when `parsed.imageOut` is defined** (guard the
    `mkdir`+`copyFile` block, lines ~115–118). The `buildTree(...)` → `process.stdout.write` path is
    **unconditional** — stdout carries the JSON tree whether or not `--image` was passed (so passing
    `--image` does NOT change stdout, per Inv-6).
  - Update `USAGE` to reflect the optional flag, e.g.
    `'Usage: dali-ui-preview <input.cpp> [--image <out.png>]   (or --version | --help)'`.
- `src/cli.ts` (same file) — no change to the `--version`/`--help`/error-to-stderr contract; stdout
  stays reserved for the JSON tree (and version/help text).

**Acceptance (user view)**: `node out/cli.js samples/hello-dali.preview.dali.cpp` (no `--image`)
exits 0 and prints the canonical JSON tree to stdout with nothing extra; adding
`--image /tmp/x.png` writes the PNG AND prints the **same** stdout (byte-identical tree); omitting
the positional input still errors clearly on stderr.

**Features**: F1.1–F1.5 are all *gated* on this (their assertion commands invoke the bare form); the
direct invariant is **Inv-6**.

**Execution tier**: **Tier 2** (render-backed: the bare-invocation form is what every F1.x command
exercises; the **F1.4 byte-identical** command is the sharpest proof that bare-vs-`--image` stdout is
stable and deterministic) **+ Tier 3** via the WU-4 suite (which runs `npm test`, exercising the CLI's
pure dependencies without docker).

EXACT cited assertion command (from `test-plan.md` **F1.3 — Stable IDs across runs**, whose two bare
invocations + id-set comparison directly exercise the now-optional `--image` / bare-stdout path):
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
(The F1.3 **optional content-edit sub-check** in `test-plan.md` lines 219–240 — id set unchanged
after editing only the label text, Inv-8 — is exercised here too as a property of the stable id; it
is NOT the M4 tree-diff feature.)

**✋**: none.

**Dependencies**: **WU-2** (the canonical tree it prints). Logically independent of WU-1's internals,
but ordered after WU-2 so the printed tree is already canonical.

---

### WU-4 — Real unit-test suite (mocha+c8) under `src/test/unit/` → Gate A GREEN

**Encodes**: the folded-in carry-over (M0 had a `test:unit` script but **zero** committed test files,
so `npm test` was vacuous and errored on no-match). M1 makes `npm test` a real **Gate A**, with
no-docker unit tests for the pure modules using the **M0 spike JSON** as the canonical fixture.

**Files to touch (concrete)** — new test files (compiled `src/test/unit/*.test.ts` →
`out/test/unit/*.test.js`; the `npm test` glob is `out/test/unit/**/*.test.js`, c8+mocha, 10 s
timeout; `tsconfig.json` already includes `src/**/*.ts` with `rootDir: src`, so **no tsconfig change**):
- `src/test/unit/treeModel.test.ts` — feed `buildTree` the **M0 spike metadata JSON** (a trimmed
  inline copy of `docs/autoplan/m0/spike-dumptree-output.txt`'s tree, in the `{root:…}` wrapper the
  harness emits, OR the canonical fixture below): assert FlexLayout + both Labels present with
  concrete `type`; each canonical node exposes `id`, `role`, `bounds{x,y,w,h}`, `children`; the root
  carries a concrete `type` (never name-only); `semanticsSource` is recorded. Assert the documented
  M0 error throws are **unchanged** (null/empty → "no scene metadata…"; non-JSON → "scene metadata
  is not valid JSON…"; non-object root → "scene metadata has no object root node.").
- `src/test/unit/harnessTemplater.test.ts` — every `{{PLACEHOLDER}}` is substituted (output contains
  no `{{…}}`); `{{USER_CODE}}` is inserted **verbatim** (Inv-5 faithful render); a leftover/unknown
  placeholder throws; width/height emit as `<n>.0f` float literals.
- `src/test/unit/inputResolver.test.ts` — preview-file mode returns the whole body with `startLine 0`;
  marker mode extracts the region between `@dali-preview-begin`/`@dali-preview-end` with the correct
  `startLine`; unsupported extension / missing markers / unreadable file throw.
- `src/test/unit/treeSchema.test.ts` — the new M1 pure logic (from WU-2's `src/treeSchema.ts`):
  - `structuralId` builds deterministic child-index paths (`structuralId("0",1)==="0/1"`,
    `structuralId("0/1",0)==="0/1/0"`) and is a **pure function of structure** (same input → same id;
    a content-only change → same id — Inv-8). Run it over a small sample tree and assert the full id
    set (`0`, `0/0`, `0/1`, `0/1/0`, `0/1/1`, …) is reproduced identically on a second pass.
  - `roleForType` turns `LabelImpl/FlexLayoutImpl/Button/Image(View)/Layer` into concrete roles
    (never `"unknown"`), with an explicit fallback (e.g. `"unknown"`/`"generic"`) for an unmapped type.
- `package.json` — **no script change needed** (`"test": "npm run test:unit"`,
  `"test:unit": "c8 mocha out/test/unit/**/*.test.js --timeout 10000"` already present and the
  toolchain — `mocha`, `c8`, `chai` — is in `devDependencies`). Touch ONLY if a glob/runner tweak is
  required for the suite to run green.

**Acceptance (user view)**: `npm run build` exits 0, then `npm test` exits 0 with mocha reporting
**all tests passing and zero failing**; the run includes real tests for `treeModel`,
`harnessTemplater`, `inputResolver`, and the id+role logic (not an empty/skip suite). c8 prints a
coverage table (coverage % informational, not a gate in M1).

**Features**: all of F1.1–F1.5 get their **≥ Tier-3** coverage here (schema, id, role, sourceLine,
determinism-of-id-as-pure-function); satisfies the folded-in unit-test carry-over.

**Execution tier**: **Tier 3** (unit; mocha + c8) — the real **Gate A**, no docker.

EXACT cited assertion command (from `test-plan.md` **Unit-test suite — `npm test`**):
```bash
npm run build && npm test; echo "test_exit=$?"
```

**✋**: none.

**Dependencies**: **WU-2** (`treeModel`/`treeSchema` are the units under test) and **WU-1** (the
harness contract the `treeModel` fixture mirrors). Validated last so the whole stack is green.

---

## 4. Dependency order

```
WU-1  harness DFS rewrite (ids + screen-extents bounds + DumpTree merge + role map + determinism)
  │   [authoritative field producer — Inv-1 ids/roles assigned here, in the one C++ DFS]
  ▼
WU-2  TS canonical treeModel (project bounds{…}, carry id/role/sourceLine/semanticsSource;
  │   extract pure treeSchema.ts {structuralId, roleForType} for unit testing)
  ▼
WU-3  cli.ts --image optional (bare invocation prints the canonical tree to stdout — Inv-6;
  │   unblocks every F1.x render-backed assertion)
  ▼
WU-4  unit-test suite (mocha+c8, M0-spike fixture → Gate A GREEN)  ── validated LAST
```

Strictly sequential (single-threaded validation): each WU's exec-assert presupposes the prior WU.
WU-1 produces the fields; WU-2 shapes them; WU-3 emits them on a bare invocation (the precondition
all F1.x commands depend on); WU-4 gates the pure logic with no docker. The render-backed Tier-2
feature commands (F1.1–F1.5) are run against the assembled WU-1+WU-2+WU-3 stack; the Tier-3 unit
suite (WU-4) is the standing gate that needs no docker and never regresses.

---

## Self-Review

- **Placeholder scan**: No `TBD`/`FIXME`/`???`/unresolved `<…>`-stub left in any WU, acceptance
  criterion, or command. The `{{…}}` tokens in WU-1/WU-4 are the literal harness-template
  substitution targets (the things being filled/asserted), not spec gaps. The `<n>` in
  "`<n>.0f` float literal" and "`<path>`" / "`0/k/j`" in the id description are pattern
  illustrations, not unfilled slots. Every assertion block is copied **verbatim** from
  `test-plan.md` (F1.1, F1.2, F1.3, F1.4, the unit-suite command) — none regenerated or invented;
  no invented CLI flags (only the real `--image`, `--version`, `--help`, bare positional input). The
  one forward-looking coordination item — `--image` becoming optional so a bare invocation prints
  the tree — is encoded as its **own WU-3** and flagged as the `test-plan.md` M1 implementation
  pre-condition, not assumed silently.
- **Consistency**: Field names match the codebase + ADRs throughout — `children` (treeModel), `id` as
  the structural child-index path (ADR-004), `role` from a control-type map replacing DumpTree
  `"unknown"` (ADR-008), `bounds{x,y,w,h}` (F1.1) projected by `treeModel` from the harness's flat
  `x/y/w/h` (the `test-plan.md` field-name tolerance, called out in WU-2), `semanticsSource`
  (ADR-003/architecture), `sourceLine` (ADR-004/F1.5). **Inv-1 preserved**: the authoritative ids
  are assigned exactly once in the harness C++ DFS (WU-1); `src/treeSchema.ts` (WU-2) is the *same
  logic mirrored in TS* purely for unit-testability, explicitly NOT a second emitter in the live
  stdout path. **Inv-2 preserved**: DumpTree is *additive* enrichment over a property-walk floor;
  `semanticsSource:"reconstructed"` still yields a complete schema-valid tree. **Inv-3** is the
  load-bearing F1.4 byte-identical gate (sorted children + stripped addresses incl. the DumpTree
  atspi `path` counter + fixed float formatting). **Inv-6** is WU-3. The dependency graph is linear
  and acyclic; each WU's cited assertion is the matching `test-plan.md` feature command. The API
  header paths/signatures were confirmed against the **live** runtime image, not assumed.
- **Scope**: Exactly the five frozen features F1.1–F1.5 + the folded-in unit-test carry-over are
  covered — four WUs, no more. Nothing from M2+ is built: no overlay/Set-of-Mark (the `mark` ordinal
  is explicitly deferred to M2 even though ADR-004 defines its strategy — WU-1 lands ONLY the
  structural `id`); no box-tree/report/token-caps/watch (M3); no image-diff/tree-diff/verdict (M4 —
  the Inv-8 "id survives content edit" appears ONLY as a property of F1.3's stable id, the optional
  F1.3 sub-check, never as the M4 diff feature); no `--theme/--resolution/--dpr` or
  structured-error/eldbus-filtering (M5 — the WU-1 determinism work strips addresses but does NOT
  build the M5 error contract); no packaging (M6). The optional golden-PNG check is scoped as an
  F1.2 *visual hold*, not an M2 overlay test.
- **Ambiguity → resolved or surfaced**:
  - *bounds shape* (canonical `bounds{x,y,w,h}` vs harness flat `x/y/w/h`) → **resolved**: WU-2's
    `treeModel` is the projector (prefer `bounds{…}`, drop flat duplicates); the cited test helper
    tolerates either via `node.bounds ?? flat`, so the projection detail does not block the gate.
  - *where the DumpTree↔property-walk join is keyed* → **resolved** per ADR-008: by **child-index
    order** (DumpTree `children[]` order == `Actor::GetChildAt(i)` order, confirmed by the M0 spike
    matching the actor structure), done inside the harness DFS (WU-1).
  - *who is the authoritative id/role assigner* → **resolved**: the harness C++ DFS (Inv-1); the TS
    `treeSchema.ts` is a tested mirror for the no-docker unit suite, not a live second source.
  - *sourceLine type & coverage* → **resolved**: numeric (or numeric string accepted by the test);
    "where derivable" floor (≥1 Label), parsed off the `__L{line}` NAME tag.
  - *exact structural-id strings / camera presence+ordering* → **deliberately not pinned** (ADR-004
    implementation choice); F1.3 asserts shape+stability+uniqueness only — the WUs follow suit.

OPEN_QUESTIONS: none blocking. (The single coordination item — `cli.ts` making `--image` optional so
the bare invocation prints the tree, Inv-6 — is encoded as WU-3 and listed as the `test-plan.md` M1
implementation pre-condition, so no WU or feature assertion is blocked on it.)
