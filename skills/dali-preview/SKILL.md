---
name: dali-preview
description: Render DALi (Tizen) C++ UI code to a PNG preview plus a JSON scene tree, so you can SEE the layout you wrote. Use when writing or editing DALi UI code, when asked to preview, screenshot, or verify a DALi layout, or when working with a .preview.dali.cpp file.
---

# DALi UI preview

Render DALi UI C++ to an image + a structured scene tree so you can verify a layout
visually instead of guessing. Backed by `dali-ui-preview-cli`, which renders headlessly
in a Docker container (the same runtime the DALi Preview VS Code extension uses).

## Preferred path: the MCP tool (returns the image inline)

If the `render_dali_preview` MCP tool is available (it ships with this plugin), **use it** —
it returns the rendered PNG as an inline image you can see directly, plus the scene tree:

- `render_dali_preview({ code: "<DALi C++>", width?, height?, theme? })` — render an inline snippet, or
- `render_dali_preview({ file: "path/to/x.preview.dali.cpp" })` — render a file.

Run `dali_preview_setup()` once first if a render reports the runtime is unavailable.

## Fallback path: the CLI directly

If the MCP tool is not available, shell out to the CLI and then **Read the PNG** to view it:

```bash
# render a file (stdout is the JSON scene tree; --image writes the PNG)
npx -y dali-ui-preview-cli path/to/screen.preview.dali.cpp --image /tmp/dali/preview.png

# or render an inline snippet from stdin
printf '%s' "$DALI_CODE" | npx -y dali-ui-preview-cli - --image /tmp/dali/preview.png
```

Then use the Read tool on `/tmp/dali/preview.png` to see the rendered layout, and parse
the JSON tree from stdout (every node's id/type/role/on-screen bounds/source line/props).

Exit codes: `0` ok · `10` compile error (your code) · `11` render error · `12` Docker
unavailable. On `10`, stderr carries `{"phase":"compile","message":...,"sourceLine":N}` —
fix the mapped source line and re-render.

## One-time setup

- **Docker** must be installed and usable by the current user.
- The runtime image (`ghcr.io/lwc0917/dali-preview-runtime`, ~290 MB) **auto-pulls on the
  first render**, or pull it explicitly: `npx -y dali-ui-preview-cli --pull`.

## Writing DALi UI code that compiles (current dali-ui API)

dali-ui is **non-fluent** — setters return `void`, so do NOT chain. Declare a named local,
call setters as separate statements, add children with `AddChildren({ ... })`, then `return`
the root:

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

A preview body ends in `return <root>;`. `Children(...)` (fluent) and `.Method().Method()`
chaining are the OLD API and will fail to compile.
