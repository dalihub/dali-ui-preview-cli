---
name: dali-preview
description: Render DALi (Tizen) C++ UI code to a PNG preview plus a JSON scene tree, so you can SEE the layout you wrote and fix it. Use when writing or editing DALi UI code, when asked to preview, screenshot, or verify a DALi layout, or when working with a .preview.dali.cpp file.
---

# DALi UI preview

When you write or edit DALi (Tizen) UI C++, **don't assume it looks right — render it and
look.** Use `dali-ui-preview-cli` as a verification tool in your edit loop.

## The loop

1. Write/edit the DALi UI code (a builder body ending in `return <root>;`, or a
   `*.preview.dali.cpp` file).
2. Render it. Write render outputs under **`.dali/`** and **reuse the same filename** each
   iteration (overwrite, don't spray `out1.png`, `out2.png`, … — `.dali/` is git-ignored
   scratch, and the tree goes to stdout, not a file):
   ```bash
   dali-ui-preview-cli <file-or-> --image .dali/preview.png
   ```
   (Not installed? one-shot with no install: `npx -y github:dalihub/dali-ui-preview-cli …`.)
3. **Read `.dali/preview.png`** to SEE the layout, and parse the JSON scene tree from
   stdout (each node's id / type / role / on-screen bounds / source line / properties).
4. If it's wrong, fix the code and go back to step 2. Repeat until it looks right.

## Setup (once)

**Install the CLI once** — it ships from GitHub (not npm); a global install keeps the render
loop fast (no re-clone per render) and leaves nothing temporary behind:

```bash
npm i -g github:dalihub/dali-ui-preview-cli
```

**Then run the preflight** so you don't discover a missing runtime mid-task:

```bash
dali-ui-preview-cli doctor
```

It prints one JSON line (no network) and exits `0` when a runtime is ready or `13` when
none is — so you can gate a render with `doctor && render`:

```json
{"schemaVersion":1,"ready":true,"recommended":"docker","configured":null,
 "runtimes":{"docker":{"available":true,"imagePulled":true,"image":"…:latest","issues":[]},
             "local":{"available":false,"prefix":null,"issues":["No DALi install found. …"]}}}
```

- `ready:true` → render with the `recommended` runtime.
- `ready:false` → **relay each runtime's `issues` to the human and stop** — the fixes
  (install Docker, install a DALi prefix + `g++`/`Xvfb`) need `sudo`, which you must not run
  silently. Don't keep retrying renders; they will just fail with exit 12/13.
- `docker.imagePulled:false` (but `available:true`) → still renderable; the first render
  pulls the ~290 MB image once — tell the human to expect that one-time wait.

There are **two runtimes** — `doctor` reports both; **Docker is the default**:

- **Docker (default, reproducible).** Docker must be installed and usable. If it isn't, ask
  the human — installing Docker needs `sudo`, which you should not do silently. The runtime
  image (~290 MB) **auto-pulls on the first render**, or: `dali-ui-preview-cli --pull`.
  **Version** tracks a DALi release (currently `dali-ui` **2.5.28** — the API here targets it);
  `--list-versions` shows exact/available versions, `--image-tag <dali_x.y.z>` pins one. The
  image is cached, so run `--pull` to upgrade when a newer runtime is published.
- **Local (native, no Docker).** For a host that already has a built DALi install plus
  `g++`/`pkg-config`/`Xvfb`. Select it per render with `--runtime local` (or the `--local`
  shorthand) and point at the install with `--dali-prefix <path>` — or set `DESKTOP_PREFIX` /
  `DALI_PREVIEW_PREFIX`. Run `dali-ui-preview-cli init` once to **detect and persist** the
  choice into `.dali/config.json`, after which a bare render uses it with no flag. Caveats:
  fidelity depends on *your* DALi build + host fonts (CJK may render as boxes without
  `fonts-noto-cjk`), and `--baseline` pixel checks are runtime-specific (don't compare a
  local baseline against a docker render). `--list-versions`/`--pull` are Docker-only.

## Reading the result

- **stdout** = the JSON scene tree (parse it directly).
- **`--image <path>`** writes the rendered PNG — Read it to view the layout.
- **dali-ui version** — stderr prints `dali-ui runtime: <version>  (docker · … | local · <prefix>)`.
  If a compile error names a removed/renamed API, check this: an old runtime version (not your
  code) is the cause — refresh it (`--pull`, or rebuild the local prefix).
- **exit codes**: `0` ok · `10` compile error in *your* code (stderr carries
  `{"phase":"compile","message":...,"sourceLine":N}` — fix that line) · `11` render error ·
  `12` Docker unavailable (run `--pull`, or start Docker) · `13` no usable runtime (from a
  render: the selected local runtime is missing its DALi prefix / `g++` / `Xvfb` /
  `pkg-config` — the stderr message says which; from `doctor`: neither runtime is ready —
  read its `issues`). Pass `--dali-prefix`, set `DESKTOP_PREFIX`, or install the tool.

## Writing DALi UI that compiles (current dali-ui API)

dali-ui is **non-fluent**: setters return `void`, so do **not** chain. Declare a named
local, call setters as separate statements, add children with `AddChildren({ ... })`, then
`return` the root:

```cpp
FlexLayout root = FlexLayout::New();
root.SetDirection(FlexDirection::COLUMN);
root.SetJustifyContent(FlexJustify::CENTER);
root.SetBackgroundColor(UiColor(0x1e1e2e));

Label title = Label::New("Hello");
title.SetFontSize(48);
title.SetTextColor(UiColor(0xFFFFFF));

root.AddChildren({ title });
return root;
```

The OLD fluent style (`Type::New().SetX().SetY().Children({...})`) will **not** compile.

**Building widgets / unknown names.** There's no special Button or TextField to learn —
compose cards, fields, and buttons from `FlexLayout`/`View` panels (`SetCornerRadius`,
`SetBackgroundColor`, `SetPadding`) with `Label` children. Easy-to-misguess types: padding is
`SetPadding(Dali::Extents(left, right, top, bottom))` (no `UiPadding`); colours are
`UiColor(0xRRGGBB)`. And don't guess exact enum/method names from memory: if unsure, just
render — a `10` compile error names the exact symbol and line, faster than reading SDK headers.

**Images.** Use `ImageView::New("assets/photo.jpg")` (or `SetResourceUrl("…")`) with a path
**relative to the preview file** (or an absolute path). The CLI copies the file into the
render so it resolves in **both** runtimes — no manual mounting. An unresolvable or remote
(`http(s)://`) URL renders a **gray placeholder** at the ImageView's size (layout preserved),
so a gray box means the path didn't resolve — fix the path or make the file local.

**Colors, padding, and components from other files.** To use a color/padding constant or a
reusable component defined elsewhere, `#include "relative/path.h"` at the top of the preview —
the CLI follows project-local (quoted, relative) includes, **inlines** the definitions, and
renders. But only specific forms are inlinable:

- ✅ a **`namespace` member** or a **`const`/`constexpr`** constant (colors/padding/sizes), and
  a **`View`-returning free function** (components). `#include` the header, then use
  `UiColor(theme::ACCENT)`, `Extents(theme::PAD, …)`, `MakeCard(…)`.
- ❌ a **`#define` macro** (change it to a `constexpr`/namespace constant), a **multi-line
  initializer**, a header reached only through a build-system `-I` flag or a `<system>`
  include, or anything outside the project folder (the one with `.git`/`package.json`).

A symbol it can't resolve becomes a **grey/blank placeholder** — grey `0x888888`, an empty
View, or `"Sample"` text — **with no error**. So a grey color or blank box means "not found":
make it a namespace/const constant or a free function and add the relative `#include`. Errors
*inside* a helper point at that file — fix them there; there's no separate-compilation linking.
For full multi-file *app* preview, the VS Code extension's slicer is more complete.

**What can't be previewed faithfully.** A preview is one static frame. When something can't
render for real, build the closest slice and **tell the human what you approximated** — don't
present a placeholder render as if it were faithful:

- **Runtime / async data** (network, DB, `GetUser()`): inject **sample data** and say so.
- **Classes needing services / view-models**: pass a **sample instance**, or wrap just the
  view-building part in a small factory rather than constructing the whole controller.
- **Manager-resolved theme / locale / app singletons**: use literal values — they aren't set
  up outside the running app.
- **Focus / animation / scroll / selection states**: a static frame is one moment — render the
  representative state and note in the tree/to the human what is dynamic.

**Output paths.** `--image`'s parent folder is auto-created; but if you redirect stdout into
a new subfolder (`> out/tree.json`), `mkdir -p out` first.
