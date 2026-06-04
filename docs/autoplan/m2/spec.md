# M2 — Set-of-Mark image↔tree linking — implementation spec

> Authored by the spec+test-planner at milestone start, AFTER the frozen
> `feature-checklist.md` (F2.1–F2.4). This file is the spec **WITH** the embedded
> test tier + the exact copy-paste assertion per WU — there is no separate
> test-plan. It encodes the design from `architecture.md`
> (**Inv-1: a node's tree `id`/`mark` and the number drawn on the overlay are the
> SAME emission — one source, cannot drift**; Inv-6: stdout JSON is the primary
> contract, image is on-demand) and the M1 carry-over that ADR-004's `mark`
> ordinal "only the structural `id` landed in M1; the overlay/`mark` rendering is
> M2". Those decisions are DECIDED — the WUs below ENCODE them, they do not
> re-litigate them.
>
> **M2 is ALL TypeScript.** No harness / C++ change. The harness already emits the
> canonical tree (per `docs/autoplan/m1/exec-validation.md`): root `Layer`
> `{id:"0", role:"panel", bounds{0,0,1024,600}}` → internal `CameraActor`,
> `FlexLayoutImpl` `{id:"0/1", role:"container"}` → two `LabelImpl`
> (`{id:"0/1/0", role:"label", bounds{381,262,262,56}}`, the second label below
> it), `CameraActor`. `bounds` is a nested `{x,y,w,h}` object on every node;
> `CameraActor` nodes carry degenerate `bounds` (`w==0,h==0`, ADR-008). The render
> canvas is **1024×600** (`dockerRunner` `DEFAULT_WIDTH/HEIGHT`).
>
> **Inv-1, made concrete for an all-TS milestone.** M1 assigned the structural
> `id` in the harness's single C++ DFS. The ordinal `mark` is assigned in
> **`treeModel.buildTree`'s single TS DFS — the same pass that already returns the
> tree** (it already recurses for `normalizeSemanticsSource`). So `id`↔`mark` are
> stamped in ONE walk over ONE tree, and every downstream surface (overlay marks,
> `--at`, `--node`, the stdout JSON) reads from that single annotated tree. There
> is no second `mark` generator. (`id` still comes from the harness; `mark` is a
> deterministic function of the same DFS visitation order — they are co-assigned
> on the same node objects, so they cannot drift: F2.2 / Inv-1.)

---

## 1. Goal

On the bundled sample, after `npm run build` (and docker present), the CLI links
the rendered image to the tree both ways, from ONE annotated tree:

- **Marks.** Every canonical node carries a stable ordinal **`mark`** (`1,2,3,…`)
  assigned in **one deterministic DFS** inside `treeModel.buildTree` (the same
  pass that returns the tree). Pre-order, parent-before-children, children in the
  existing child-index order → the same input yields the same marks every run
  (re-uses the F1.4 determinism the tree already has).

- **Overlay (F2.1).** `node out/cli.js samples/hello-dali.preview.dali.cpp --overlay out.png`
  renders, then writes an **annotated PNG**: for every node whose `bounds` are
  **non-degenerate** (`w>0 && h>0`) and on-canvas, a rectangle outline is drawn
  around its box and that node's **`mark` number** is drawn near the box (a small
  legible bitmap-digit tag). `--overlay` implies render. The numbers drawn equal
  the `mark` values in the tree (F2.2 set-equality, Inv-1) — auditable because the
  overlay reads marks from the very tree the JSON is built from.

- **Coordinate → node (F2.3).** `--at X,Y` prints the **topmost = smallest-area**
  node whose `bounds` contain pixel (X,Y) as `{id, mark, type, role}`, or
  `{ "at":[X,Y], "node":null }` when no node contains it. (The root Layer fills
  the whole 1024×600 canvas, so a hit inside the "Hello, Dali!" label must resolve
  to the *label*, not the Layer — smallest-area wins.)

- **Node → image region (F2.4).** `--node <id>` prints `{id, mark, type, role, bounds}`
  for the node with that `id`, or `null` when no node has that id, so a caller can
  crop/confirm it against the overlay.

- **Lookups are pure + unit-tested.** The two queries (coord→node, id→node) live in
  a new pure module **`src/treeQuery.ts`** so they get no-docker unit tests; the
  `mark`-assignment logic gets unit tests too. `npm test` stays GREEN (Gate A).

**Stdout contract (decided here, Inv-6-aligned).** `--at` / `--node` are *query*
flags: they print **only their lookup JSON** to stdout (a single JSON value +
newline) and do **not** print the full tree. A bare render (no query flag) still
prints the full tree (M1 behaviour, unchanged). `--overlay` writes a file and is
orthogonal to stdout: stdout still carries the full tree unless a query flag is
also present. If both `--at` and `--node` are given, that is an error (one query
per invocation — keeps the stdout contract a single JSON value).

This is the **demonstration** from the frozen checklist: a render emits a PNG
annotated with numbered marks whose numbers equal the tree nodes' `mark`s; `--at`
returns the node at a pixel; `--node` returns its image box; marks and ids come
from one source and cannot drift.

---

## 2. Out of scope (deferred — do NOT build in M2)

| Deferred item | Milestone |
|---|---|
| Box-drawing **tree formatter**, **HTML/MD report**, **token caps** (`--max-depth`/`--max-nodes`), **watch** mode. | **M3** |
| **Image-diff** / **tree-diff** / **verdict** / `--update-baseline` (`pixelmatch` stays unused in M2). | **M4** |
| **Config flags** `--theme`/`--resolution`/`--dpr`, **structured-error contract**, eldbus/D-Bus **stderr filtering**. | **M5** |
| **Packaging** (`npx` publish, GHCR pull-by-tag UX). | **M6** |
| Any **harness / C++** change, new render fields, re-deriving `id` in TS, an a11y-bridge dependency. | — (M2 is pure TS over the existing canonical tree; `id` stays harness-authored — Inv-1.) |
| A second `mark` generator anywhere outside the one `buildTree` DFS; "meaningful node" heuristics beyond the `w>0 && h>0 && on-canvas` rule. | — (Inv-1 + keep it deterministic/simple.) |

New features discovered mid-M2 → `docs/autoplan/m2/oos-queue.md` (do NOT fold into
these WUs).

---

## 3. Work units

Single-threaded, strictly ordered for sequential validation. Four WUs:
**(WU-1)** stamp `mark` in the one `treeModel` DFS [Inv-1; the field every other WU
reads] → **(WU-2)** pure `src/treeQuery.ts` lookups (coord→node, id→node) +
`src/overlayRenderer.ts` pngjs annotator → **(WU-3)** wire `--overlay`/`--at`/`--node`
into `cli.ts` (stdout contract) → **(WU-4)** unit tests for `mark` + lookups, `npm
test` GREEN. WU-1 is the load-bearing field; WU-2 builds the pure consumers; WU-3
surfaces them on the CLI; WU-4 gates the pure logic with no docker.

> **Tier vocabulary** (same as M1 `test-plan.md`): this is a CLI (`node-cli`,
> `cpp-native`) → **Tier 1 = none** for the CLI surface. Per-WU tier is stated
> below: **Tier 2** = render-backed exec-assert on a real `node out/cli.js …`
> invocation; **Tier 3** = no-docker unit (`npm test`, mocha+c8). **Global
> pre-conditions** for every Tier-2 assertion: `npm run build` exited 0 AND docker
> is reachable (`docker info` ok) AND the runtime image is present; if `docker
> info` fails, render-backed Tier-2 assertions record `SKIPPED (docker
> unavailable)` and the Tier-3 unit suite (WU-4, no docker) is the standing gate.
> The F2.1 overlay correctness has a **✋ vision hold** (an LLM-vision judgement of
> the annotated PNG — Read it and confirm legible numbered boxes sit on the
> controls); the machine gate for F2.1 is the PNG-validity + mark-parity assertion
> below, the ✋ is additive, not the gate.

---

### WU-1 — Stamp a stable ordinal `mark` on every node in the one `treeModel` DFS

**Encodes**: Inv-1 (ids↔marks one source — the `mark` is co-assigned with the
already-harness-authored `id`, in the single TS DFS that returns the tree); ADR-004
(`mark` is the ordinal companion to the structural `id`, deferred from M1 to M2);
F1.4/Inv-3 reused (deterministic DFS order → deterministic marks); F2.2 floor
(every tree node has exactly one mark, so the overlay's drawn marks can be a subset
of — and equal in set to — the tree's marks).

**Files to touch (concrete)**:
- `src/treeModel.ts`:
  - Add `mark: number` to the `MinimalNode` interface doc-comment (it already has
    the `[key: string]: unknown` index signature, so the field type-checks; add an
    explicit `/** Stable ordinal mark (1-based), assigned in the buildTree DFS. */
    mark?: number;` to the interface for clarity and so consumers can read it
    typed).
  - Add a single pure function `assignMarks(root: MinimalNode): void` that walks the
    tree **pre-order** (visit node, then recurse `children` in array order) and
    assigns `node.mark = nextMark++` starting at **1**, mutating in place. EVERY
    node gets a mark — including `CameraActor` nodes (uniform, simplest, and the
    overlay/`--at` filter on `bounds`, not on mark presence). Mirror the existing
    `normalizeSemanticsSource` shape (same null/array guards) for consistency.
  - Call `assignMarks(root)` inside `buildTree`, **once**, right after
    `normalizeSemanticsSource(root)` and BEFORE the `sourceLine` merge / `return`
    (so the returned tree — the single source every formatter consumes — already
    carries marks). Do NOT assign marks anywhere else (Inv-1: one source).
  - Determinism: the DFS order is the existing child-index order (no re-sort), so
    two `buildTree` calls on the same metadata produce identical marks (extends the
    F1.4 byte-identical guarantee to the new field). Marks are a function of
    structure only.
  - Do NOT change the error throws, `semanticsSource` normalization, root-type
    stamping, or `sourceLine` merge — those M1 behaviours must not regress (WU-4
    unit tests pin them).

**Acceptance (user view)**: after `npm run build`, a bare render of the sample
emits a JSON tree where EVERY node carries a numeric `mark`; the marks are exactly
`1..N` (a contiguous set, no gaps, no duplicates) in pre-order; the root's mark is
`1`; two consecutive renders produce the identical mark assignment (byte-identical
stdout still holds).

**Features**: F2.2 (every tree node has a mark — the parity floor), and the `mark`
half of F2.1/F2.3/F2.4 (the field they all read).

**Execution tier**: **Tier 2** (render-backed: bare invocation prints the tree with
marks) **+ Tier 3** (WU-4 unit-tests `assignMarks` over a fixture with no docker —
the standing gate while iterating).

EXACT copy-paste assertion (Tier 2 — marks are contiguous 1..N, unique, root=1,
and stable across two renders):
```bash
set -o pipefail
node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m2-w1-a.json 2>/dev/null
node out/cli.js samples/hello-dali.preview.dali.cpp 1>/tmp/m2-w1-b.json 2>/dev/null
node -e '
  const fs=require("fs");
  const root=JSON.parse(fs.readFileSync("/tmp/m2-w1-a.json","utf8"));
  const marks=[]; (function w(n){ if(!n||typeof n!=="object")return; marks.push(n.mark); (n.children||[]).forEach(w); })(root);
  const fails=[];
  if(marks.length===0) fails.push("no nodes walked");
  if(!marks.every(m=>Number.isInteger(m))) fails.push("a node is missing an integer mark: "+JSON.stringify(marks));
  if(typeof root.mark!=="number"||root.mark!==1) fails.push("root.mark must be 1, got "+root.mark);
  const sorted=[...marks].sort((a,b)=>a-b);
  const expected=Array.from({length:marks.length},(_,i)=>i+1);
  if(JSON.stringify(sorted)!==JSON.stringify(expected)) fails.push("marks are not the contiguous set 1.."+marks.length+": "+JSON.stringify(sorted));
  if(new Set(marks).size!==marks.length) fails.push("marks are not unique (duplicate mark)");
  // determinism: identical assignment across two renders
  const b=JSON.parse(fs.readFileSync("/tmp/m2-w1-b.json","utf8"));
  const mb=[]; (function w(n){ if(!n||typeof n!=="object")return; mb.push(n.mark); (n.children||[]).forEach(w); })(b);
  if(JSON.stringify(marks)!==JSON.stringify(mb)) fails.push("mark assignment differs across two renders (non-deterministic)");
  if(fails.length){ console.error("FAIL WU-1:\n - "+fails.join("\n - ")); process.exit(1); }
  console.log("PASS WU-1: "+marks.length+" nodes, marks=1.."+marks.length+" (contiguous, unique, root=1, pre-order), stable across 2 renders");
'
```

**✋**: none.

**Dependencies**: none (first WU; extends the existing `buildTree` DFS).

---

### WU-2 — Pure lookups `src/treeQuery.ts` (coord→node, id→node) + `src/overlayRenderer.ts` pngjs annotator

**Encodes**: F2.3 (coord→node = smallest containing box), F2.4 (id→node region),
F2.1 (Set-of-Mark overlay drawing). The lookups are **pure functions of the
annotated tree** (testable with no docker — WU-4); the overlay reads marks from
that same tree (Inv-1).

**Files to touch (concrete)**:
- `src/treeQuery.ts` (NEW — pure, no docker, no fs):
  - `export interface NodeRegion { id:string; mark:number; type:string; role?:string; bounds:{x:number;y:number;w:number;h:number}; }`
    (a flat record lifted off a `MinimalNode`).
  - `export function nodeAt(root: MinimalNode, x:number, y:number): MinimalNode | null` —
    walk the whole tree collecting every node whose `bounds` **contain** (x,y) with a
    half-open rule `bx <= x < bx+bw && by <= y < by+bh` AND non-degenerate `w>0&&h>0`
    (so the zero-area `CameraActor` boxes never match); return the one with the
    **smallest area** (`w*h`); ties broken by **larger `mark`** (deeper / later in
    pre-order = more specific) for determinism; `null` if none contain the pixel.
    Guard nodes whose `bounds` is missing or not numeric (skip them).
  - `export function nodeById(root: MinimalNode, id:string): MinimalNode | null` —
    DFS; return the first node whose `id === id` (ids are unique per F1.3), else `null`.
  - `export function toRegion(node: MinimalNode): NodeRegion` — project the four
    contract fields + `bounds{x,y,w,h}`; used by the CLI to shape `--at`/`--node`
    output (keeps the stdout shape defined in ONE place).
  - No printing, no process exit, no fs — pure so WU-4 unit-tests it directly.
- `src/overlayRenderer.ts` (NEW — uses `pngjs`; reads/writes files):
  - `export async function renderOverlay(srcPngPath: string, root: MinimalNode, outPngPath: string): Promise<{ marksDrawn: number[] }>`:
    1. Read the source PNG via `pngjs` (`PNG.sync.read(fs.readFileSync(srcPngPath))`
       → `{width,height,data}`, RGBA 4 bytes/px — confirmed against the installed
       `pngjs@7`).
    2. Collect the **drawable** nodes: those with numeric `bounds`, `w>0 && h>0`,
       and at least partially **on-canvas** (`x < width && y < height && x+w > 0 &&
       y+h > 0`). (Excludes the zero-area `CameraActor` boxes and anything fully
       off-canvas.)
    3. For each drawable node, draw a **rectangle outline** (clamp each edge to the
       canvas bounds; set the 4 border rows/cols of pixels to a fixed high-contrast
       colour, e.g. magenta `#FF00FF` opaque) and draw its **`mark`** number as a
       tiny legible **3×5 bitmap-digit** string near the top-left corner of the box
       (a small filled background tag behind the digits so they stay readable over
       any render). Drawing is deterministic (fixed colours, fixed font bitmap,
       nodes drawn in mark order).
    4. Write the annotated PNG to `outPngPath`
       (`fs.writeFileSync(outPngPath, PNG.sync.write(png))`).
    5. Return `{ marksDrawn }` — the sorted list of marks actually drawn (the
       on-canvas, non-degenerate subset) so the CLI / tests can assert
       mark-parity (F2.2: drawn marks ⊆ tree marks, and the drawn set equals the
       set of drawable-node marks).
  - Keep the digit bitmap + a `setPixel(data,width,x,y,r,g,b)` helper local and
    pure-ish (bounds-checked) so the only side effects are the two fs calls.
    Determinism: no timestamps, no PNG metadata text chunks, fixed bit depth.

**Acceptance (user view)**: `nodeAt` over the sample tree returns the "Hello,
Dali!" `LabelImpl` for a pixel inside its `{381,262,262,56}` box (not the root
Layer — smallest area wins) and `null` for a far-off-canvas pixel; `nodeById`
returns the FlexLayoutImpl for `"0/1"` and `null` for a bogus id;
`renderOverlay` reads the rendered PNG and writes a same-dimensions annotated PNG
whose `marksDrawn` are all present in the tree (subset), drawing one numbered box
per on-canvas non-degenerate node.

**Features**: F2.3 (`nodeAt`), F2.4 (`nodeById`/`toRegion`), F2.1 (`renderOverlay`).

**Execution tier**: **Tier 3** (these are pure/file modules — their direct gate is
the WU-4 unit suite, no docker). Their render-backed end-to-end proof is WU-3's
Tier-2 CLI assertions (where `--at`/`--node`/`--overlay` invoke them).

EXACT copy-paste assertion (Tier 3 — exercise the pure modules with a crafted
fixture mirroring the real tree, no docker; this is also a fast standing gate
while iterating WU-2):
```bash
node -e '
  const path=require("path"), os=require("os"), fs=require("fs");
  const tq=require("./out/treeQuery.js");
  const ov=require("./out/overlayRenderer.js");
  const {PNG}=require("pngjs");
  // Fixture mirroring the real tree: Layer(0,full canvas) > [CameraActor(zero box),
  // FlexLayoutImpl(0/1), Label(0/1/0 small box)]. marks pre-order 1..4.
  const W=1024,H=600;
  const root={ id:"0", type:"Layer", role:"panel", mark:1, bounds:{x:0,y:0,w:W,h:H}, children:[
    { id:"0/0", type:"CameraActor", mark:2, bounds:{x:0,y:0,w:0,h:0} },
    { id:"0/1", type:"FlexLayoutImpl", role:"container", mark:3, bounds:{x:0,y:0,w:W,h:H}, children:[
      { id:"0/1/0", type:"LabelImpl", role:"label", mark:4, bounds:{x:381,y:262,w:262,h:56} },
    ]},
  ]};
  const fails=[];
  // F2.3: a pixel inside the label box resolves to the LABEL (smallest area), not the Layer.
  const hit=tq.nodeAt(root,400,280);
  if(!hit||hit.id!=="0/1/0") fails.push("nodeAt(400,280) should be the LabelImpl 0/1/0, got "+(hit&&hit.id));
  // F2.3: a far-off pixel → null
  if(tq.nodeAt(root,5000,5000)!==null) fails.push("nodeAt off-canvas should be null");
  // F2.3: zero-area CameraActor never wins even at its origin (label still smaller-or-only non-degenerate at 400,280)
  // F2.4: id lookup
  const n=tq.nodeById(root,"0/1");
  if(!n||n.type!=="FlexLayoutImpl") fails.push("nodeById(0/1) should be FlexLayoutImpl");
  if(tq.nodeById(root,"9/9/9")!==null) fails.push("nodeById of a bogus id should be null");
  // toRegion shape
  const r=tq.toRegion(hit);
  for(const k of ["id","mark","type","bounds"]) if(!(k in r)) fails.push("toRegion missing "+k);
  if(!(r.bounds&&typeof r.bounds.w==="number")) fails.push("toRegion.bounds.w not numeric");
  // F2.1: write a tiny source PNG, overlay it, assert same dims + marksDrawn ⊆ tree marks (and excludes the zero-area camera)
  const src=new PNG({width:W,height:H}); src.data.fill(0x20);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"m2-ov-"));
  const srcP=path.join(tmp,"src.png"), outP=path.join(tmp,"out.png");
  fs.writeFileSync(srcP, PNG.sync.write(src));
  ov.renderOverlay(srcP, root, outP).then(res=>{
    if(!fs.existsSync(outP)||fs.statSync(outP).size===0) fails.push("overlay PNG not written / empty");
    const out=PNG.sync.read(fs.readFileSync(outP));
    if(out.width!==W||out.height!==H) fails.push("overlay dims changed: "+out.width+"x"+out.height);
    const treeMarks=new Set([1,2,3,4]);
    if(!res.marksDrawn.every(m=>treeMarks.has(m))) fails.push("marksDrawn not a subset of tree marks: "+JSON.stringify(res.marksDrawn));
    if(res.marksDrawn.includes(2)) fails.push("zero-area CameraActor (mark 2) must NOT be drawn");
    if(!res.marksDrawn.includes(4)) fails.push("the LabelImpl (mark 4) should be drawn");
    if(fails.length){ console.error("FAIL WU-2:\n - "+fails.join("\n - ")); process.exit(1); }
    console.log("PASS WU-2: nodeAt smallest-area, nodeById, toRegion, overlay same-dims, marksDrawn="+JSON.stringify(res.marksDrawn)+" (subset, no zero-area camera)");
  }).catch(e=>{ console.error("FAIL WU-2 (threw): "+e.message); process.exit(1); });
'
```
(This is the fast no-docker proof. The authoritative regression gate for these
modules is the WU-4 mocha suite; the same assertions are codified there.)

**✋**: none (the *visual* legibility of the overlay is exercised under WU-3/F2.1
on a real render — the ✋ vision hold lives there, not on this synthetic fixture).

**Dependencies**: **WU-1** (the `mark` field these consume). Logically independent
of the CLI wiring (WU-3).

---

### WU-3 — Wire `--overlay <png>` / `--at X,Y` / `--node <id>` into `cli.ts` (stdout contract)

**Encodes**: F2.1 (`--overlay` writes the annotated PNG, implies render), F2.3
(`--at` prints the coord lookup), F2.4 (`--node` prints the id lookup), Inv-6 (the
query flags print only their lookup JSON; a bare render still prints the full tree;
`--overlay` is a file side-effect orthogonal to stdout).

**Files to touch (concrete)**:
- `src/cli.ts`:
  - `RenderArgs`: add `overlayOut?: string` (path for `--overlay`),
    `at?: { x:number; y:number }` (from `--at X,Y`), `nodeId?: string` (from
    `--node <id>`).
  - `parseRenderArgs`: parse the three flags alongside the existing `--image`/`--code`
    parsing (same value-presence + duplicate-flag guards as `--image`):
    - `--overlay <png>` — requires a path value (reject missing / leading-dash, like
      `--image`); duplicate → throw.
    - `--at X,Y` — requires a value matching `^-?\d+,-?\d+$`; parse to `{x,y}` integers;
      a malformed value throws `'--at requires X,Y integer pixel coordinates.'`;
      duplicate → throw.
    - `--node <id>` — requires a value (reject missing; the id is a structural path so
      it won't start with `-`); duplicate → throw.
    - **Mutual exclusion**: if BOTH `--at` and `--node` are present, throw
      `'pass at most one query flag: --at or --node, not both.'` (keeps stdout a
      single JSON value).
  - `runRender` — after the render produces `result` and `buildTree(...)` yields the
    annotated `tree` (now carrying marks):
    - **`--overlay`** (independent of the query flags): when `parsed.overlayOut` is
      set, `await renderOverlay(result.pngPath, tree, parsed.overlayOut)` (mkdir its
      destDir first, like `--image`). `--overlay` implies render (render already
      happened); it is a file write, it does NOT consume the stdout slot.
    - **stdout selection (the contract)**:
      - if `parsed.at` is set → `const hit = nodeAt(tree, x, y); process.stdout.write(JSON.stringify(hit ? toRegion(hit) : { at:[x,y], node:null }) + "\n")` — and DO NOT print the full tree.
      - else if `parsed.nodeId` is set → `const n = nodeById(tree, id); process.stdout.write(JSON.stringify(n ? toRegion(n) : null) + "\n")` — and DO NOT print the full tree.
      - else → the existing `process.stdout.write(JSON.stringify(tree)+"\n")` (full
        tree, M1 behaviour, unchanged).
    - `--image` still works and is orthogonal (copy the PNG out when set); a single
      invocation may combine `--image` + `--overlay` (both files written) but stdout
      is governed solely by the query-flag selection above.
  - Update `USAGE` to document the three new flags and the contract, e.g. add lines:
    `'       dali-ui-preview <input.cpp> --overlay <out.png>   (write a Set-of-Mark annotated PNG)'`,
    `'       dali-ui-preview <input.cpp> --at X,Y               (print the topmost node at a pixel)'`,
    `'       dali-ui-preview <input.cpp> --node <id>            (print that node id\'s region)'`,
    and a one-line note that `--at`/`--node` print only the lookup JSON while a bare
    render prints the full tree.
  - Imports: `renderOverlay` from `./overlayRenderer`; `nodeAt`, `nodeById`,
    `toRegion` from `./treeQuery`.
  - Keep diagnostics on stderr, stdout reserved for the JSON (full tree OR the single
    lookup value) and version/help text (unchanged contract).

**Acceptance (user view)**:
- `node out/cli.js <sample> --overlay /tmp/ov.png` exits 0, writes a valid PNG to
  `/tmp/ov.png` (same dimensions as the render, non-empty), and stdout still carries
  the full tree JSON.
- `node out/cli.js <sample> --at 400,280` prints exactly one JSON object
  `{id,mark,type,role}` for the "Hello, Dali!" label (not the root Layer) and nothing
  else; `--at 5000,5000` prints `{"at":[5000,5000],"node":null}`.
- `node out/cli.js <sample> --node 0/1` prints `{id,mark,type,role,bounds}` for the
  FlexLayoutImpl; `--node bogus/9` prints `null`.
- A bare `node out/cli.js <sample>` (no query flag) still prints the full tree.

**Features**: F2.1 (`--overlay`), F2.3 (`--at`), F2.4 (`--node`); Inv-6 (stdout
contract).

**Execution tier**: **Tier 2** (render-backed CLI exec-assert) **+ Tier 3** (the
arg-parse guards — duplicate/malformed/mutual-exclusion — get unit coverage in WU-4
where `parseRenderArgs` is exported/testable; if it stays private, the Tier-2
commands below cover them). **F2.1 overlay legibility is a ✋ vision hold.**

EXACT copy-paste assertion (Tier 2 — `--at`, `--node`, and `--overlay` against a
real render; PNG validated via pngjs; mark-parity asserted):
```bash
set -o pipefail
# F2.3 --at : a pixel inside the "Hello, Dali!" label box {381,262,262,56} -> the LABEL (smallest area), with {id,mark,type,role}
node out/cli.js samples/hello-dali.preview.dali.cpp --at 500,290 1>/tmp/m2-at.json 2>/dev/null
node -e '
  const fs=require("fs"); const r=JSON.parse(fs.readFileSync("/tmp/m2-at.json","utf8"));
  const fails=[];
  if(!r||typeof r!=="object") fails.push("--at did not print a JSON object");
  for(const k of ["id","mark","type","role"]) if(!(k in r)) fails.push("--at result missing "+k);
  if(r.type!=="LabelImpl") fails.push("--at 500,290 should be the LabelImpl (smallest containing box), got type="+r.type+" id="+r.id);
  if(typeof r.mark!=="number") fails.push("--at result mark is not numeric");
  // it must NOT be the full tree (no children array at top level for a query result)
  if(Array.isArray(r.children)) fails.push("--at printed the full tree (children present) instead of just the lookup");
  if(fails.length){ console.error("FAIL F2.3 --at:\n - "+fails.join("\n - ")); process.exit(1); }
  console.log("PASS F2.3 --at: pixel(500,290) -> "+JSON.stringify({id:r.id,mark:r.mark,type:r.type,role:r.role})+" (label, not Layer; lookup-only stdout)");
'
# F2.3 --at miss : off-canvas -> { at:[X,Y], node:null }
node out/cli.js samples/hello-dali.preview.dali.cpp --at 9000,9000 1>/tmp/m2-atmiss.json 2>/dev/null
node -e '
  const fs=require("fs"); const r=JSON.parse(fs.readFileSync("/tmp/m2-atmiss.json","utf8"));
  if(!(r&&r.node===null&&Array.isArray(r.at)&&r.at[0]===9000&&r.at[1]===9000)){ console.error("FAIL F2.3 --at miss: expected {at:[9000,9000],node:null}, got "+JSON.stringify(r)); process.exit(1); }
  console.log("PASS F2.3 --at miss: off-canvas pixel -> {at:[9000,9000],node:null}");
'
# F2.4 --node : the root Layer id "0" -> {id,mark,type,role,bounds}, and a bogus id -> null
node out/cli.js samples/hello-dali.preview.dali.cpp --node 0 1>/tmp/m2-node.json 2>/dev/null
node out/cli.js samples/hello-dali.preview.dali.cpp --node nope/9 1>/tmp/m2-nodemiss.json 2>/dev/null
node -e '
  const fs=require("fs"); const r=JSON.parse(fs.readFileSync("/tmp/m2-node.json","utf8"));
  const fails=[];
  for(const k of ["id","mark","type","role","bounds"]) if(!(k in r)) fails.push("--node result missing "+k);
  if(r.id!=="0") fails.push("--node 0 should echo id 0, got "+r.id);
  if(!(r.bounds&&["x","y","w","h"].every(k=>typeof r.bounds[k]==="number"))) fails.push("--node bounds{x,y,w,h} not all numeric");
  if(Array.isArray(r.children)) fails.push("--node printed the full tree instead of just the lookup");
  const miss=JSON.parse(fs.readFileSync("/tmp/m2-nodemiss.json","utf8"));
  if(miss!==null) fails.push("--node of a bogus id should print null, got "+JSON.stringify(miss));
  if(fails.length){ console.error("FAIL F2.4 --node:\n - "+fails.join("\n - ")); process.exit(1); }
  console.log("PASS F2.4 --node: id 0 -> {id,mark,type,role,bounds}; bogus id -> null");
'
# F2.1 (machine gate) --overlay : writes a valid same-dims PNG; bare-tree stdout intact; mark-parity (every node with a non-degenerate on-canvas box has a tree mark)
node out/cli.js samples/hello-dali.preview.dali.cpp --overlay /tmp/m2-overlay.png 1>/tmp/m2-overlay-tree.json 2>/dev/null
file /tmp/m2-overlay.png
node -e '
  const fs=require("fs"); const {PNG}=require("pngjs");
  const fails=[];
  if(!fs.existsSync("/tmp/m2-overlay.png")||fs.statSync("/tmp/m2-overlay.png").size===0) fails.push("overlay PNG missing/empty");
  const out=PNG.sync.read(fs.readFileSync("/tmp/m2-overlay.png"));
  if(out.width!==1024||out.height!==600) fails.push("overlay dims not 1024x600: "+out.width+"x"+out.height);
  // stdout still the FULL tree (overlay is orthogonal to stdout, Inv-6)
  const tree=JSON.parse(fs.readFileSync("/tmp/m2-overlay-tree.json","utf8"));
  if(!Array.isArray(tree.children)) fails.push("--overlay must not change stdout: full tree still expected");
  // F2.2 mark-parity floor: collect tree marks; the drawable subset (non-degenerate on-canvas boxes) is non-empty and ⊆ tree marks
  const tm=new Set(); const drawable=[];
  (function w(n){ if(!n||typeof n!=="object")return; if(typeof n.mark==="number") tm.add(n.mark);
     const b=n.bounds; if(b&&b.w>0&&b.h>0&&b.x<1024&&b.y<600&&b.x+b.w>0&&b.y+b.h>0) drawable.push(n.mark);
     (n.children||[]).forEach(w); })(tree);
  if(drawable.length<1) fails.push("no drawable (non-degenerate on-canvas) node found — overlay would be empty");
  if(!drawable.every(m=>tm.has(m))) fails.push("a drawable mark is not in the tree mark set (Inv-1 violated)");
  if(fails.length){ console.error("FAIL F2.1 (machine gate):\n - "+fails.join("\n - ")); process.exit(1); }
  console.log("PASS F2.1 (machine gate): overlay 1024x600 PNG written; bare-tree stdout intact; "+drawable.length+" drawable marks ⊆ "+tm.size+" tree marks");
'
```

**✋**: 1 — **F2.1 overlay visual legibility (LLM-vision hold)**: Read
`/tmp/m2-overlay.png` (the annotated PNG from the assertion above) and confirm by
eye that (a) a high-contrast rectangle outline sits on each meaningful control —
notably the two text labels and their container — and (b) each box has a small,
legible **number** drawn near it. This is a judgement the machine gate cannot make
(the machine gate proves the PNG is valid, same-dimensions, and mark-parity holds;
it cannot judge "legible"). Record the verdict (and the read image) under the
milestone's visual-holds log; it is additive, not the gate.

**Dependencies**: **WU-1** (marks) and **WU-2** (`renderOverlay`, `nodeAt`,
`nodeById`, `toRegion`). Ordered after both so the wiring calls real modules.

---

### WU-4 — Unit tests for `mark` assignment + `treeQuery` lookups → `npm test` GREEN (Gate A)

**Encodes**: the M1 Gate-A precedent (`npm test` is a real gate, must stay green and
never regress; new features MUST ship tests — project `CLAUDE.md` testing
requirements). M2 adds no-docker unit coverage for the pure new logic: the `mark`
DFS and the `treeQuery` lookups (and a lightweight `overlayRenderer` check).

**Files to touch (concrete)** — compiled `src/test/unit/*.test.ts` →
`out/test/unit/*.test.js`; `npm test` glob is `out/test/unit/**/*.test.js`
(c8+mocha, 10 s timeout); `tsconfig.json` already includes `src/**/*.ts` → **no
tsconfig change**:
- `src/test/unit/treeModel.test.ts` — **extend** (do not rewrite the existing M1
  cases): add a `describe('mark assignment (M2/F2.2)')` that feeds `buildTree` the
  existing `fixtureMetadata()` and asserts: every node has an integer `mark`; the
  marks are the contiguous set `1..N` with no gaps/dupes; the root's mark is `1`;
  marks follow **pre-order** (root `1`, then first child subtree before later
  siblings — assert specific marks against the known fixture shape:
  Layer=1, first CameraActor=2, FlexLayoutImpl=3, Label=4, Label=5, last
  CameraActor=6); a second `buildTree` of the same metadata yields the identical
  mark assignment (determinism). The existing M1 assertions (error throws,
  semanticsSource, sourceLine, root-type) must still pass unchanged.
- `src/test/unit/treeQuery.test.ts` (NEW) — over a crafted tree mirroring the real
  shape (Layer full-canvas mark 1; CameraActor zero-box; FlexLayoutImpl full-canvas;
  LabelImpl `{381,262,262,56}`):
  - `nodeAt`: a pixel inside the label box returns the **LabelImpl** (smallest area),
    NOT the root Layer; a pixel inside the Layer but outside the label returns the
    Layer; an off-canvas pixel returns `null`; the half-open edge rule
    (`x==bx+bw` is OUTSIDE) holds; a zero-area `CameraActor` is never returned even
    at its own origin.
  - `nodeById`: returns the right node for `"0"`, `"0/1"`, `"0/1/0"`; returns `null`
    for a bogus id.
  - `toRegion`: projects exactly `{id,mark,type,role,bounds{x,y,w,h}}` and drops
    `children`.
- `src/test/unit/overlayRenderer.test.ts` (NEW) — pure-ish, uses a `tmpdir` PNG (no
  docker): write a small solid PNG via `pngjs`, call `renderOverlay` over the crafted
  tree, assert the output PNG exists, is the **same dimensions**, is re-readable by
  `pngjs`, differs from the source (some pixels changed = something was drawn), and
  `marksDrawn` is a non-empty subset of the tree's marks that EXCLUDES the zero-area
  `CameraActor` and INCLUDES the label. (Asserts behaviour, not exact pixels — keeps
  it robust to the digit-font choice.)
- `package.json` — **no script change** (`"test": "npm run test:unit"`,
  `"test:unit": "c8 mocha out/test/unit/**/*.test.js --timeout 10000"` already
  present; `mocha`/`c8`/`chai` + `@types/pngjs` already in devDependencies). Touch
  ONLY if a glob/runner tweak is required.

**Acceptance (user view)**: `npm run build` exits 0, then `npm test` exits 0 with
mocha reporting **all tests passing and zero failing** — the run now also includes
the M2 mark-assignment, `treeQuery`, and `overlayRenderer` tests, and the M1 suite
still passes (no regression). c8 prints its coverage table (coverage % informational,
not a gate in M2).

**Features**: F2.1/F2.2/F2.3/F2.4 each get their **Tier-3** no-docker coverage here.

**Execution tier**: **Tier 3** (unit; mocha + c8) — the real **Gate A**, no docker.

EXACT copy-paste assertion (Tier 3):
```bash
npm run build && npm test; echo "test_exit=$?"
```

**✋**: none.

**Dependencies**: **WU-1** (mark logic under test), **WU-2** (`treeQuery` /
`overlayRenderer` under test). Validated last so the whole M2 stack is green.

---

## 4. Dependency order

```
WU-1  stamp `mark` in the one treeModel.buildTree DFS
  │   [Inv-1: ids↔marks one source — co-assigned with the harness-authored id; the field every other WU reads]
  ▼
WU-2  pure src/treeQuery.ts (nodeAt smallest-area, nodeById, toRegion)
  │   + src/overlayRenderer.ts (pngjs Set-of-Mark annotator; returns marksDrawn)
  ▼
WU-3  cli.ts wiring: --overlay (file, implies render) / --at X,Y / --node <id>
  │   [stdout contract: query flags print only the lookup JSON; bare render prints the full tree — Inv-6]
  ▼
WU-4  unit tests: mark assignment + treeQuery + overlayRenderer  →  npm test GREEN  ── validated LAST
```

Strictly sequential (single-threaded validation): each WU's exec-assert presupposes
the prior WU. WU-1 produces `mark`; WU-2 builds the pure consumers of `mark` +
`bounds`; WU-3 surfaces them on the CLI with the stdout contract; WU-4 gates the
pure logic with no docker. The render-backed Tier-2 commands (WU-1, WU-3 / F2.1
machine gate + F2.3 + F2.4) run against the assembled stack; the Tier-3 unit suite
(WU-4) is the standing gate that needs no docker and never regresses. The F2.1
overlay **visual** legibility is the single ✋ vision hold (WU-3), additive to its
machine gate.

---

## Self-Review

- **Placeholder scan**: No `TBD`/`FIXME`/`???`/unresolved stub in any WU, acceptance
  criterion, or command. `<png>`/`<id>`/`X,Y`/`1..N`/`0/1/0` are pattern
  illustrations (flag argument shapes, structural-path examples), not unfilled
  slots. Every assertion block is concrete and copy-paste runnable assuming `npm run
  build` is done (and docker present for the render-backed ones). Only real flags are
  introduced — the three this milestone owns (`--overlay`, `--at`, `--node`) plus the
  pre-existing `--image`/`--code`/`--version`/`--help`/bare-positional — no invented
  extras. The one stdout-contract decision (query flags print only the lookup; bare
  render prints the full tree; `--overlay` is orthogonal) is stated explicitly in the
  Goal and encoded in WU-3, not assumed silently.
- **Internal consistency**: Field names match the codebase + M1 throughout —
  `bounds{x,y,w,h}` as a nested object on every node (per `exec-validation.md`,
  passed through by `treeModel`), `id` the structural child-index path (harness-
  authored, F1.3), `role`, `type`, `children`. **Inv-1 preserved**: the `mark` is
  co-assigned with the existing `id` in the **single** `buildTree` DFS (the same pass
  that runs `normalizeSemanticsSource` and returns the tree) — there is exactly one
  `mark` generator, and the overlay + `--at` + `--node` + stdout JSON all read that
  one annotated tree; nothing re-derives `mark` or `id`. **F2.2** is the
  drawable-marks ⊆ tree-marks set relation, asserted in both the WU-3 machine gate
  and the WU-2/WU-4 unit checks. **Inv-6 preserved**: a bare render still prints the
  full tree; the query flags carve a single-JSON-value stdout; `--overlay`/`--image`
  are file side-effects that do not touch stdout. **Determinism** (F1.4/Inv-3) is
  inherited: the mark DFS uses the existing child-index order, and the overlay uses
  fixed colours/font/order with no timestamps — WU-1's assertion pins mark stability
  across two renders. The dependency graph is linear and acyclic; each WU's tier and
  assertion are stated inline (spec-with-embedded-tests, as required).
- **Scope**: Exactly the four frozen features F2.1–F2.4 are covered in four WUs, no
  more. M2 is **all TypeScript** — no harness/C++ change, no new render field, no
  re-derived `id`, no a11y-bridge dependency (all listed Out-of-scope). Nothing from
  M3+ is built: no box-tree/report/token-caps/watch (M3); no image-diff/tree-diff/
  verdict and `pixelmatch` stays unused (M4); no `--theme/--resolution/--dpr` or
  structured errors (M5); no packaging (M6). The lookups + mark logic are isolated in
  pure modules (`treeQuery.ts`, `buildTree`/`assignMarks`) precisely so they are unit-
  testable, and `npm test` stays GREEN (Gate A) with the M1 suite intact.
- **Ambiguity → resolved or surfaced**:
  - *stdout contract for query flags* → **resolved**: `--at`/`--node` print only the
    lookup JSON (single value); a bare render prints the full tree; the two queries
    are mutually exclusive (one JSON value per invocation). Stated in Goal + WU-3.
  - *which node `--at` returns when boxes nest (root Layer fills the canvas)* →
    **resolved**: smallest containing **area** wins (ties → larger `mark` = deeper),
    with a half-open edge rule and a `w>0&&h>0` non-degeneracy filter so the zero-area
    `CameraActor` boxes never match. Asserted (label, not Layer) in WU-2 + WU-3.
  - *which nodes the overlay draws* → **resolved**: nodes with numeric `bounds`,
    `w>0 && h>0`, at least partially on-canvas — `marksDrawn` is that subset and is
    proved ⊆ the tree's marks (F2.2/Inv-1). "Meaningful node" = that exact rule, no
    extra heuristics (kept simple/deterministic).
  - *digit rendering* → **resolved as a method, not pinned to pixels**: a small fixed
    3×5 bitmap-digit tag (deterministic); tests assert *behaviour* (same dims, pixels
    changed, marks-drawn subset), and **legibility** is the single explicit ✋ vision
    hold on F2.1 (the machine gate proves validity/parity; an LLM reads the PNG for
    "legible numbered boxes").
  - *where `mark` is assigned* → **resolved**: in `treeModel.buildTree`'s existing
    DFS, once, after `normalizeSemanticsSource`, before return — Inv-1's single
    source; never a second emitter.

OPEN_QUESTIONS: none blocking. (`--overlay` could alternatively gate on `--image`'s
PNG per the checklist's "`--marks` with `--image`" phrasing; this spec takes the
checklist's *primary* `--overlay <png>` form — it implies its own render and writes
the annotated PNG directly — which is self-contained and matches the demonstration
sentence. The `--marks`+`--image` variant is not built, to keep one overlay path.)
