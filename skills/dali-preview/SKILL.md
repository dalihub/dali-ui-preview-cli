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
2. Render it:
   ```bash
   npx -y dali-ui-preview-cli <file-or-> --image .dali/preview.png
   ```
   (Not on npm yet? use `npx -y github:dalihub/dali-ui-preview-cli …`.)
3. **Read `.dali/preview.png`** to SEE the layout, and parse the JSON scene tree from
   stdout (each node's id / type / role / on-screen bounds / source line / properties).
4. If it's wrong, fix the code and go back to step 2. Repeat until it looks right.

## Setup (once)

- **Docker** must be installed and usable. If it isn't, ask the human — installing Docker
  needs `sudo`, which you should not do silently.
- The runtime image (~290 MB) **auto-pulls on the first render**, or: `npx -y dali-ui-preview-cli --pull`.

## Reading the result

- **stdout** = the JSON scene tree (parse it directly).
- **`--image <path>`** writes the rendered PNG — Read it to view the layout.
- **exit codes**: `0` ok · `10` compile error in *your* code (stderr carries
  `{"phase":"compile","message":...,"sourceLine":N}` — fix that line) · `11` render error ·
  `12` Docker unavailable (run `--pull`, or start Docker).

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

**Cross-file components.** To use a helper/type/const defined in another project file,
`#include "path/to/it.h"` (relative path) at the top of the preview — the CLI follows
project-local includes, **inlines** those definitions, and renders. Limits: only
header-inlinable defs inside the project (folder with `.git`/`package.json`); a symbol it
can't find becomes a **grey placeholder** (so a blank box means you forgot to `#include`
it); errors *inside* a helper point at that file — fix them there; no separate-compilation
linking. For full multi-file *app* preview, the VS Code extension's slicer is more complete.

**Output paths.** `--image`'s parent folder is auto-created; but if you redirect stdout into
a new subfolder (`> out/tree.json`), `mkdir -p out` first.
