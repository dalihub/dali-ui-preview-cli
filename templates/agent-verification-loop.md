# Verifying DALi UI in your edit loop

> **Drop-in agent instructions.** Copy this block into your project's `AGENTS.md`
> (Codex, Cursor, …) or `CLAUDE.md` (Claude Code) so the agent renders and checks
> the DALi UI it writes — instead of guessing. (Claude Code users who installed the
> `dali-ui-preview` plugin already get this via the bundled skill + MCP tool.)

---

## Verify DALi UI with dali-ui-preview-cli

When you write or edit DALi (Tizen) UI C++ in this project, **do not assume it looks
right — render it and look.** Use `dali-ui-preview-cli` as a verification tool in your
edit loop:

1. Write/edit the DALi UI code (a builder body ending in `return <root>;`, or a
   `*.preview.dali.cpp` file).
2. Render it:
   ```bash
   npx -y dali-ui-preview-cli <file-or-> --image .dali/preview.png
   # not on npm yet? run it straight from GitHub (no npm publish needed):
   #   npx -y github:dalihub/dali-ui-preview-cli <file-or-> --image .dali/preview.png
   ```
3. **Read `.dali/preview.png`** to SEE the layout, and parse the JSON scene tree from
   stdout (each node's id / type / role / on-screen bounds / source line / properties).
4. If it's wrong, fix the code and go back to step 2. Repeat until it looks right.

### Setup (once)
- **Docker** must be installed and usable. If it isn't, ask the human — installing
  Docker needs `sudo`, which you should not do silently.
- The runtime image (~290 MB) **auto-pulls on the first render**, or pull it explicitly:
  `npx -y dali-ui-preview-cli --pull`.

### Reading the result
- **stdout** = the JSON scene tree (pipe-friendly; parse it directly).
- **`--image <path>`** writes the rendered PNG — Read it to view the layout.
- **exit codes**: `0` ok · `10` compile error in *your* code (stderr carries
  `{"phase":"compile","message":...,"sourceLine":N}` — fix that line) · `11` render
  error · `12` Docker unavailable (run `--pull`, or start Docker).

### Writing DALi UI that compiles (current dali-ui API)
dali-ui is **non-fluent**: setters return `void`, so do **not** chain. Declare a named
local, call setters as separate statements, add children with `AddChildren({ ... })`,
then `return` the root:

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
