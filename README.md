# dali-ui-preview

Render Tizen DALi UI C++ to a PNG **and** a structured JSON scene tree — built for AI agents and humans alike. Write DALi UI code → render it headlessly → get back a screenshot plus a machine-readable node tree → verify it against a target.

## Why

LLM coding agents can write UI code, but they can't *see* whether it looks right. `dali-ui-preview` closes that loop for [DALi](https://docs.tizen.org/application/native/guides/ui/dali/) (Tizen's Dynamic Animation Library):

- **Render** a snippet of DALi C++ to a real PNG, headlessly, in a container.
- **Inspect** the result as a canonical JSON tree — every node's id, type, role, on-screen bounds, source line, and properties.
- **Locate** a node by pixel (`--at X,Y`) or by id (`--node`), or annotate the image with numbered boxes (`--overlay`, a "Set-of-Mark" image agents can point at).
- **Verify** a new render against a baseline image and/or a target tree, and branch on the exit code.

`stdout` is *pure JSON* (or pure box-tree); all diagnostics go to `stderr`; output is deterministic. That makes it safe to pipe straight into an agent's JSON parser.

## Prerequisites

- **Docker.** Rendering runs inside the `ghcr.io/lwc0917/dali-preview-runtime` container (DALi Toolkit + Xvfb for off-screen rendering). The image is **pulled automatically on the first render**.
- **Node.js >= 18** (only to run the CLI itself).

> **Shared with the DALi Preview VS Code extension.** This CLI uses the *same* runtime image and the *same* named volumes (`dali-preview-ccache`, `dali-preview-shader-cache`) as the [DALi Preview VS Code extension](https://docs.tizen.org/). If you already use the extension, the image and warm build caches are reused — no extra download, faster renders.

The container is only needed for the render path. `--version`, `--help`, and the pure tree/overlay/diff logic do not touch Docker.

## Install

Run it ad-hoc with npx (no install):

```bash
npx dali-ui-preview <input.cpp> --image out.png
```

Or from source:

```bash
git clone https://github.com/lwc0917/dali-ui-preview
cd dali-ui-preview
npm install
npm run build
node out/cli.js <input.cpp>
```

## Quickstart

Render a preview file and print its scene tree:

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp
```

stdout (a single JSON line; pretty-printed here):

```json
{
  "id": "0",
  "type": "Layer",
  "role": "panel",
  "name": "RootLayer",
  "mark": 1,
  "bounds": { "x": 0, "y": 0, "w": 1024, "h": 600 },
  "children": [
    { "id": "0/0", "type": "CameraActor", "role": "camera", "name": "", "mark": 2, "bounds": { "x": 0, "y": 0, "w": 0, "h": 0 }, "visible": true, "opacity": 1, "children": [] },
    {
      "id": "0/1",
      "type": "FlexLayoutImpl",
      "role": "container",
      "name": "",
      "mark": 3,
      "bounds": { "x": 0, "y": 0, "w": 1024, "h": 600 },
      "visible": true,
      "opacity": 1,
      "flexProps": { "direction": "COLUMN", "alignItems": "CENTER", "justifyContent": "CENTER", "wrap": "NO_WRAP" },
      "sourceLine": 13,
      "semanticsSource": "bridge",
      "children": [
        {
          "id": "0/1/0",
          "type": "LabelImpl",
          "role": "label",
          "name": "",
          "text": "Hello, Dali!",
          "mark": 4,
          "bounds": { "x": 381, "y": 262, "w": 262, "h": 56 },
          "visible": true,
          "opacity": 1,
          "sourceLine": 21,
          "semanticsSource": "bridge",
          "children": []
        },
        {
          "id": "0/1/1",
          "type": "LabelImpl",
          "role": "label",
          "name": "",
          "text": "Edit this file to see the preview update",
          "mark": 5,
          "bounds": { "x": 251, "y": 322, "w": 522, "h": 22 },
          "visible": true,
          "opacity": 1,
          "sourceLine": 25,
          "semanticsSource": "bridge",
          "children": []
        }
      ]
    },
    { "id": "0/2", "type": "CameraActor", "role": "camera", "name": "", "mark": 6, "bounds": { "x": 0, "y": 0, "w": 0, "h": 0 }, "visible": true, "opacity": 1, "children": [] }
  ],
  "meta": { "resolution": { "w": 1024, "h": 600 }, "theme": "dark", "dpr": 1 }
}
```

(The tree has **6** nodes: the root `Layer`, the `FlexLayoutImpl`, its two `LabelImpl`s, and the two internal `CameraActor`s DALi inserts as leading/trailing siblings. A label's `name` is empty — its displayed text is in `text`.)

Also write the screenshot:

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --image out.png
```

`--image` is optional and orthogonal to stdout: it writes the PNG but does not change the JSON.

## Input modes

The preview code can come from three sources (pass exactly one):

```bash
# 1. A file — a *.preview.dali.cpp file, or a regular .cpp/.h with
#    @dali-preview-begin / @dali-preview-end markers.
node out/cli.js samples/hello-dali.preview.dali.cpp

# 2. STDIN — a `-` positional, or just piped in.
cat samples/hello-dali.preview.dali.cpp | node out/cli.js
node out/cli.js - < samples/hello-dali.preview.dali.cpp

# 3. Inline — a code block passed on the command line.
node out/cli.js --code 'return Label::New("Hello, Dali!");'
```

## Worked examples

Each headline feature, one example. Most flags compose; the exceptions are noted in `--help`.

### Annotated screenshot — `--overlay`

Write a "Set-of-Mark" PNG: each node gets a numbered magenta box matching its `mark` in the tree, so an agent can refer to controls by number.

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --overlay overlay.png
```

### Locate a node — `--at` / `--node`

Find the topmost node at a pixel:

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --at 500,290
```

```json
{ "id": "0/1/0", "mark": 4, "type": "LabelImpl", "role": "label", "bounds": { "x": 381, "y": 262, "w": 262, "h": 56 } }
```

Or look up a node's region by id:

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --node 0/1/0
```

Both print **only** their lookup JSON (the smallest box that contains the pixel wins). They are mutually exclusive.

### Human-readable tree — `--format tree`

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --format tree
```

```text
Layer "RootLayer" #1  [0]  (1024x600 @ 0,0)
┠╴ CameraActor "" #2  [0/0]  (0x0 @ 0,0)
┠╴ FlexLayoutImpl "" #3  [0/1]  (1024x600 @ 0,0)
┃  ┠╴ LabelImpl "" #4  [0/1/0]  (262x56 @ 381,262)
┃  ┖╴ LabelImpl "" #5  [0/1/1]  (522x22 @ 251,322)
┖╴ CameraActor "" #6  [0/2]  (0x0 @ 0,0)
```

(The box-tree line shows the actor `name`, which is empty for labels; the displayed text lives in the JSON `text` field.)

### Self-contained report — `--report`

Write an HTML or Markdown report (embedded PNG + box-tree + node table). The JSON tree is still printed to stdout.

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --report report.html
node out/cli.js samples/hello-dali.preview.dali.cpp --report report.md
```

### Bound the output for token limits — `--max-depth` / `--max-nodes`

Trim the stdout JSON so it fits an agent's context window (a `truncated` marker shows where pruning stopped):

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --max-depth 1
node out/cli.js samples/hello-dali.preview.dali.cpp --max-nodes 3
```

### The verify loop — `--baseline` / `--baseline-tree` / `--update-baseline`

The agent loop is **write → render → verify → branch on `$?`**.

First, capture a baseline from a known-good render:

```bash
node out/cli.js good.cpp --update-baseline --baseline golden.png --baseline-tree golden.json
```

Then verify a new render against it. stdout becomes a single verdict; the exit code is **0 on match, 20 on divergence**:

```bash
node out/cli.js candidate.cpp --baseline golden.png --baseline-tree golden.json
echo "exit: $?"
```

A passing verdict:

```json
{
  "match": true,
  "image": { "dimsMatch": true, "diffPixels": 0, "totalPixels": 614400, "ratio": 0, "pass": true },
  "tree": { "added": [], "removed": [], "changed": [] }
}
```

A divergent one (exit 20) — e.g. a node whose bounds moved:

```json
{
  "match": false,
  "image": { "dimsMatch": true, "diffPixels": 4673, "totalPixels": 614400, "ratio": 0.0076, "pass": false },
  "tree": { "added": [], "removed": [], "changed": [{ "id": "0/1/0", "fields": ["bounds"] }] }
}
```

You can verify either dimension alone (just `--baseline` for image, just `--baseline-tree` for tree). `--threshold <ratio>` (default `0.01`) sets how many pixels may differ before the image fails.

### Render config — `--resolution` / `--theme` / `--dpr`

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --resolution 800x480 --theme light --dpr 2
```

- `--resolution WxH` — logical render size (default `1024x600`).
- `--theme dark|light` — background theme (default `dark`).
- `--dpr N` — device-pixel ratio (default `1`); the actual render is `resolution × dpr` device pixels.

The *effective* logical config is echoed on the root as `root.meta = { resolution, theme, dpr }`.

### Live re-render — `--watch`

Re-render and re-emit on every change to the input file (FILE input only). One emission per render; Ctrl-C to stop.

```bash
node out/cli.js samples/hello-dali.preview.dali.cpp --watch
```

## JSON node schema

Every node in the tree has this shape (some fields are best-effort and may be absent):

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable structural path (child-index), e.g. `"0/1/0"`. |
| `mark` | number | 1-based ordinal; the number drawn on `--overlay`. |
| `type` | string | Concrete DALi type, e.g. `"LabelImpl"`, `"FlexLayoutImpl"`, `"Layer"`. |
| `role` | string | Semantic role, e.g. `"label"`, `"container"`, `"panel"`. |
| `name` | string | Actor name (often empty; the root is `"RootLayer"`). A label's displayed text is in `text`, not here. |
| `text` | string | The displayed text of a text control (Label / InputField). Present only when the control has non-empty text. |
| `bounds` | `{x,y,w,h}` | On-screen box in image pixels (`CalculateCurrentScreenExtents`). |
| `visible` | boolean | The actor's `VISIBLE` property. |
| `opacity` | number | The actor's `OPACITY` (0..1). |
| `sourceLine` | number | 1-based line in your source the node maps to (when resolvable). |
| `semanticsSource` | string | `"bridge"` or `"reconstructed"` — where the semantics came from. |
| `properties` | object | Exported DALi properties for the node (e.g. `{ "textColor": [r,g,b,a] }` or `{ "backgroundColor": [...] }`). |
| `flexProps` | object | Present on flex containers: the resolved flex layout, e.g. `{ "direction": "COLUMN", "alignItems": "CENTER", "justifyContent": "CENTER", "wrap": "NO_WRAP" }`. |
| `children` | node[] | Child nodes, in child-index order. |

The **root** node additionally carries `meta`:

```json
"meta": { "resolution": { "w": 1024, "h": 600 }, "theme": "dark", "dpr": 1 }
```

Note: DALi inserts internal `CameraActor` siblings (zero-area boxes); `--at`/`--node` ignore degenerate boxes, so cameras never match a pixel query.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (also: a verify verdict that matched). |
| `1` | Usage error, or empty input. |
| `10` | Compile error in your code. |
| `11` | Render / capture error. |
| `12` | Docker unavailable (the `docker info` preflight failed). |
| `20` | Verify diff mismatch (rendered, but diverged from the baseline). |

On a compile/render failure, a structured `{ "phase", "message", "sourceLine" }` JSON is printed to **stderr** (stdout stays empty), e.g.:

```json
{ "phase": "compile", "message": "'Banana' has not been declared", "sourceLine": 14 }
```

## For AI agents

- **stdout is the machine contract.** A bare render prints the full tree JSON; `--format tree` prints a box-tree; `--at`/`--node` print one lookup object; verify mode prints one verdict object. Exactly one emission per render.
- **stderr is for diagnostics**, including the structured compile/render error. Parse stdout, watch the exit code, read stderr only on failure.
- **Deterministic.** The same input renders byte-identical JSON, so diffs are meaningful.
- **Token caps.** Use `--max-depth` / `--max-nodes` to keep the tree within a context window.
- **Branchable exit codes.** Distinguish "tool failed" (1/10/11/12) from "rendered but differs" (20) without parsing text.

## License

Apache-2.0.
