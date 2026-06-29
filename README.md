# dali-ui-preview-cli

Render Tizen DALi UI C++ to a PNG **and** a structured JSON scene tree — built for AI agents and humans alike.

**English** | [한국어](README.ko.md)

## What it does

Write a snippet of DALi (Tizen's Dynamic Animation Library) UI C++, and this CLI renders it headlessly inside a Docker container, then hands you back two things: a real **PNG screenshot** and a deterministic, machine-readable **UI scene tree** (every node's id, type, role, on-screen bounds, source line, and properties). You can then **verify** that render against a target image and/or tree and branch on the exit code. `stdout` is pure JSON, so it drops straight into an agent's parser.

## Why

LLM coding agents can write UI code, but they can't *see* whether it looks right. `dali-ui-preview-cli` closes that loop: an agent runs **write → render → compare → rewrite**, reading the structured tree first (cheap, exact, diffable) and the image second (for vision). No DALi SDK build is required on your machine — just Docker. The same loop is just as useful for a human eyeballing a layout in a terminal.

## Prerequisites

- **Docker**, usable by your user (the render preflight runs `docker info`).
- **Node.js >= 18** (only to run the CLI itself).
- The runtime image **auto-pulls on the first render** (`ghcr.io/lwc0917/dali-preview-runtime`, ~290 MB; DALi Toolkit + Xvfb for off-screen rendering).

> **Shared with the DALi Preview VS Code extension.** This CLI uses the *same* runtime image and the *same* named volumes (`dali-preview-ccache`, `dali-preview-shader-cache`) as the DALi Preview VS Code extension. If you already use the extension, the image and warm build caches are reused — no extra download, faster renders, and updating the image once benefits both.

The container is only needed for the render path. `--version`, `--help`, `--list-versions`, and the pure tree/overlay/diff logic do not require a live daemon.

## Install

Run it ad-hoc with npx (no install):

```bash
npx dali-ui-preview-cli <input.cpp> --image out.png
```

Or from source:

```bash
git clone https://github.com/lwc0917/dali-ui-preview
cd dali-ui-preview
npm install
npm run build
node out/cli.js <input.cpp>
# optional: expose it on your PATH as `dali-ui-preview-cli`
npm link
```

All examples below use `dali-ui-preview-cli`; substitute `node out/cli.js` when running from a source checkout, or `npx dali-ui-preview-cli`.

## Use it from an AI coding agent (Claude Code)

The easiest way for a **coding agent to render your DALi code and see the result inline** is
the bundled **Claude Code plugin** — it ships a *skill* (so the agent knows when/how to render)
and an *MCP server* (so the rendered PNG comes back as an inline image, not just a file path).

Install it in Claude Code (two commands):

```
/plugin marketplace add dalihub/dali-ui-preview-cli
/plugin install dali-ui-preview@dali-tools
```

That's it — the agent can now call the **`render_dali_preview`** tool (returns the PNG **plus**
the JSON scene tree) and **`dali_preview_setup`** (one-time: pull the runtime image). Requires
**Docker** on the machine; the runtime image auto-pulls on first render.

> Other agents / no plugin? The MCP server is just `npx -y dali-ui-preview-cli mcp` (stdio) —
> add it to any MCP-capable client. Or skip MCP entirely and have the agent run the CLI and
> Read the PNG (see [Quickstart](#quickstart)).

## Quickstart

Render a preview file and print its scene tree:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp
```

`stdout` is a single JSON line (pretty-printed and trimmed here):

```json
{
  "id": "0",
  "type": "Layer",
  "role": "panel",
  "name": "RootLayer",
  "mark": 1,
  "bounds": { "x": 0, "y": 0, "w": 1920, "h": 1080 },
  "children": [
    {
      "id": "0/1",
      "type": "FlexLayoutImpl",
      "role": "container",
      "mark": 3,
      "bounds": { "x": 0, "y": 0, "w": 1920, "h": 1080 },
      "sourceLine": 13,
      "flexProps": { "direction": "COLUMN", "alignItems": "CENTER", "justifyContent": "CENTER", "wrap": "NO_WRAP" },
      "children": [
        {
          "id": "0/1/0",
          "type": "LabelImpl",
          "role": "label",
          "text": "Hello, Dali!",
          "mark": 4,
          "bounds": { "x": 829, "y": 502, "w": 262, "h": 56 },
          "sourceLine": 21,
          "children": []
        },
        {
          "id": "0/1/1",
          "type": "LabelImpl",
          "role": "label",
          "text": "Edit this file to see the preview update",
          "mark": 5,
          "bounds": { "x": 787, "y": 558, "w": 346, "h": 20 },
          "sourceLine": 25,
          "children": []
        }
      ]
    }
  ],
  "meta": { "resolution": { "w": 1920, "h": 1080 }, "theme": "dark", "dpr": 1 }
}
```

(The full tree also includes the two internal zero-area `CameraActor` siblings DALi inserts. A label's `name` is empty — its displayed text is in `text`.)

Also write the screenshot:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --image out.png
```

`--image` is optional and orthogonal to stdout: it writes the PNG but does not change the JSON.

## Input modes

The preview code can come from three sources (pass exactly one):

```bash
# 1. A FILE — a *.preview.dali.cpp file, or a regular .cpp/.h with
#    @dali-preview-begin / @dali-preview-end markers delimiting the region.
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp

# 2. STDIN — a `-` positional, or just piped in (no positional).
cat samples/hello-dali.preview.dali.cpp | dali-ui-preview-cli
dali-ui-preview-cli - < samples/hello-dali.preview.dali.cpp

# 3. INLINE — a code block passed on the command line.
dali-ui-preview-cli --code 'return Label::New("Hello, Dali!");'
```

## Features

Each group below is one labelled example: the exact command and what you get back. Most flags compose; the exceptions are noted in `--help`.

### Annotated screenshot (Set-of-Mark) — `--overlay`

Write a "Set-of-Mark" PNG: each node gets a numbered magenta box matching its `mark` in the tree, so an agent (or a person) can refer to a control by number.

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --overlay overlay.png
```

You get `overlay.png` with boxes labelled `#1 Layer`, `#3 FlexLayoutImpl`, `#4 "Hello, Dali!"`, `#5` subtitle, etc. The JSON tree is still printed to stdout.

### Locate a node — `--at` / `--node`

Find the topmost node at a pixel:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --at 500,290
```

```json
{ "id": "0/1/0", "mark": 4, "type": "LabelImpl", "role": "label", "bounds": { "x": 829, "y": 502, "w": 262, "h": 56 } }
```

Or look up a node's region by id:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --node 0/1/0
```

Both print **only** their lookup JSON (the smallest box containing the pixel wins). They are mutually exclusive. A miss prints `{ "at": [x,y], "node": null }` (for `--at`) or `null` (for `--node`).

### Human-readable tree — `--format tree`

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --format tree
```

```text
Layer "RootLayer" #1  [0]  (1920x1080 @ 0,0)
┠╴CameraActor "DefaultCamera" #2  [0/0]  (0x0 @ 960,540)
┠╴FlexLayoutImpl "" #3  [0/1]  (1920x1080 @ 0,0)
┃ ┠╴LabelImpl "" #4  [0/1/0]  (262x56 @ 829,502)
┃ ┖╴LabelImpl "" #5  [0/1/1]  (346x20 @ 787,558)
┖╴CameraActor "CaptureDefaultCamera" #6  [0/2]  (0x0 @ 960,540)
```

The box-tree line shows the actor `name` (empty for labels); the displayed text lives in the JSON `text` field. `--format json` is the default.

### Self-contained report — `--report`

Write an HTML or Markdown report (embedded PNG + box-tree + node table). The JSON tree is still printed to stdout; the file extension picks the format.

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --report report.html
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --report report.md
```

### Bound the output for token limits — `--max-depth` / `--max-nodes`

Trim the stdout JSON so it fits an agent's context window (a `truncated` marker shows where pruning stopped):

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --max-depth 1
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --max-nodes 3
```

### The verify loop — `--baseline` / `--baseline-tree` / `--update-baseline`

The agent loop is **write → render → verify → branch on `$?`**.

First, capture a baseline from a known-good render:

```bash
dali-ui-preview-cli good.cpp --update-baseline --baseline golden.png --baseline-tree golden.json
```

Then verify a new render against it. stdout becomes a single verdict; the exit code is **0 on match, 20 on divergence** (other codes still mean a tool failure):

```bash
dali-ui-preview-cli candidate.cpp --baseline golden.png --baseline-tree golden.json
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

You can verify either dimension alone (just `--baseline` for the image, just `--baseline-tree` for the tree). `--threshold <ratio>` (default `0.01`) sets how many pixels may differ before the image fails; it requires `--baseline`.

### Render config — `--resolution` / `--theme` / `--dpr`

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --resolution 800x480 --theme light --dpr 2
```

- `--resolution WxH` — logical render size (default `1920x1080`, the TV FHD profile).
- `--theme dark|light` — background theme (default `dark`).
- `--dpr N` — device-pixel ratio (default `1`); the actual render is `resolution × dpr` device pixels.

The *effective* logical config is echoed on the root as `root.meta = { resolution, theme, dpr }`.

### Live re-render — `--watch`

Re-render and re-emit on every change to the input file (FILE input only — not stdin or `--code`). One emission per render; Ctrl-C to stop.

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --watch
```

## Runtime versions (DALi releases)

The render runs against `ghcr.io/lwc0917/dali-preview-runtime`. Its tags track **DALi releases**: one `dali_<version>` tag per release (e.g. `dali_2.5.18`) plus a rolling `latest`. The first render pulls a tag automatically; these commands manage which one you have and use. Because the image and caches are **shared with the VS Code extension**, updating the runtime once benefits both tools.

List the available versions (remote registry ∪ your local store) as JSON — does **not** render, exit 0:

```bash
dali-ui-preview-cli --list-versions
```

```json
{
  "image": "ghcr.io/lwc0917/dali-preview-runtime",
  "current": "latest",
  "versions": [
    { "tag": "latest", "local": true, "current": true },
    { "tag": "dali_2.5.18", "local": false, "current": false }
  ]
}
```

Pull a specific tag ahead of time (default `latest`); docker's progress streams to stderr, then a `{"pulled":"<ref>","ok":true}` line to stdout:

```bash
dali-ui-preview-cli --pull                 # pulls :latest
dali-ui-preview-cli --pull dali_2.5.18      # pulls a specific DALi release
```

Render against a specific DALi version for *this* render with `--image-tag`:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --image-tag dali_2.5.18
```

Advanced: `--runtime-image <name>` overrides the image name itself (e.g. a private mirror). `--list-versions` / `--pull` take no input and cannot be combined with render or verify flags.

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
| `bounds` | `{x,y,w,h}` | On-screen box in image pixels (from `CalculateCurrentScreenExtents`). |
| `sourceLine` | number | 1-based line in your source the node maps to (when resolvable). |
| `semanticsSource` | string | `"bridge"` or `"reconstructed"` — where the semantics came from. |
| `visible` | boolean | The actor's `VISIBLE` property. |
| `opacity` | number | The actor's `OPACITY` (0..1). |
| `properties` | object | Exported DALi properties for the node (e.g. `{ "textColor": [r,g,b,a] }`). |
| `flexProps` | object | Present on flex containers: the resolved flex layout, e.g. `{ "direction": "COLUMN", "alignItems": "CENTER", "justifyContent": "CENTER", "wrap": "NO_WRAP" }`. |
| `children` | node[] | Child nodes, in child-index order. |

The **root** node additionally carries `meta`:

```json
"meta": { "resolution": { "w": 1920, "h": 1080 }, "theme": "dark", "dpr": 1 }
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
{ "phase": "compile", "message": "'Banana' has not been declared", "sourceLine": 13 }
```

## For AI agents

- **stdout is the machine contract.** A bare render prints the full tree JSON; `--format tree` prints a box-tree; `--at`/`--node` print one lookup object; verify mode prints one verdict object; `--list-versions`/`--pull` print one management object. Exactly one emission per invocation.
- **stderr is for diagnostics**, including the structured compile/render error `{phase, message, sourceLine}`. Parse stdout, watch the exit code, read stderr only on failure.
- **Deterministic.** The same input renders byte-identical JSON, so tree diffs are meaningful and a `--baseline-tree` comparison is exact.
- **Token caps.** Use `--max-depth` / `--max-nodes` to keep the tree within a context window.
- **Branchable exit codes.** Distinguish "tool failed" (1/10/11/12) from "rendered but differs" (20) without parsing any text — ideal for the write→render→verify loop.
- **Future option:** wrap the CLI as an MCP server (a process that exposes tools to Claude/Cursor) so an agent can call `render_preview(code)` directly instead of shelling out.

## License

Apache-2.0.
