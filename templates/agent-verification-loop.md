# Verifying DALi UI in your edit loop

> **Drop-in agent instructions.** Copy this block into your project's `AGENTS.md`
> (Codex, Cursor, …) or `CLAUDE.md` (Claude Code) so the agent renders and checks
> the DALi UI it writes — instead of guessing. (`dali-ui-preview-cli init` writes this
> for you; Claude Code users can instead install the bundled `dali-preview` skill.)

---

## Verify DALi UI with dali-ui-preview-cli

When you write or edit DALi (Tizen) UI C++ in this project, **do not assume it looks
right — render it and look.** Use `dali-ui-preview-cli` as a verification tool in your
edit loop:

1. Write/edit the DALi UI code (a builder body ending in `return <root>;`, or a
   `*.preview.dali.cpp` file).
2. Render it. Write render outputs under **`.dali/`** and **reuse the same filename** each
   iteration (overwrite — don't spray `out1.png`, `out2.png`, …; `.dali/` is git-ignored
   scratch, and the tree goes to stdout, not a file):
   ```bash
   dali-ui-preview-cli <file-or-> --image .dali/preview.png
   # not installed? one-shot straight from GitHub (no install):
   #   npx -y github:dalihub/dali-ui-preview-cli <file-or-> --image .dali/preview.png
   ```
3. **Read `.dali/preview.png`** to SEE the layout, and parse the JSON scene tree from
   stdout (each node's id / type / role / on-screen bounds / source line / properties).
4. If it's wrong, fix the code and go back to step 2. Repeat until it looks right.

### Setup (once)
**Install the CLI once** — it ships from GitHub (not npm); a global install keeps the render
loop fast (no re-clone per render) and leaves nothing temporary behind:
```bash
npm i -g github:dalihub/dali-ui-preview-cli
```
**Then run the preflight** — don't discover a missing runtime mid-task:
```bash
dali-ui-preview-cli doctor   # one JSON line, no network; exit 0 ready / 13 none
```
It reports `{ready, recommended, configured, runtimes:{docker,local}}`. If `ready:true`,
render with the `recommended` runtime. If `ready:false`, **relay each runtime's `issues`
to the human and stop** — the fixes (install Docker, or a DALi prefix + `g++`/`Xvfb`) need
`sudo`, which you must not run silently; retrying renders will just fail with exit 12/13.
(`docker.imagePulled:false` with `available:true` still renders — the first render pulls
the ~290 MB image once.) You can gate a render in a script with `doctor && render`.

There are **two runtimes** — `doctor` reports both; **Docker is the default**.

- **Docker (default, reproducible).** Docker must be installed and usable. If it isn't,
  ask the human — installing Docker needs `sudo`, which you should not do silently. The
  runtime image (~290 MB) **auto-pulls on the first render**, or pull it explicitly:
  `dali-ui-preview-cli --pull`. The image tracks a **DALi release** (currently
  `dali-ui` **2.5.26** — the API below targets it); `--list-versions` prints the exact
  version and what's available, `--image-tag <dali_x.y.z>` pins one. The image is
  **cached** once pulled — run `--pull` to upgrade when a newer runtime is published.
- **Local (native, no Docker).** For a host that already has a built DALi install plus
  `g++`/`pkg-config`/`Xvfb`. Add `--runtime local` (or `--local`) to a render and point at
  the install with `--dali-prefix <path>` — or set `DESKTOP_PREFIX` / `DALI_PREVIEW_PREFIX`.
  `dali-ui-preview-cli init` **detects and persists** the choice into `.dali/config.json`,
  after which a bare render uses it with no flag. Caveats: fidelity depends on *your* DALi
  build + host fonts (CJK may render as boxes without `fonts-noto-cjk`), and `--baseline`
  pixel checks are runtime-specific. `--list-versions`/`--pull` are Docker-only.

### Reading the result
- **stdout** = the JSON scene tree (pipe-friendly; parse it directly). If you redirect it
  into a *new* subfolder (`> out/tree.json`), create that folder first (`mkdir -p out`) —
  a shell `>` won't create it.
- **`--image <path>`** writes the rendered PNG (its parent folder **is** auto-created) —
  Read it to view the layout.
- **dali-ui version** — stderr prints `dali-ui runtime: <version>  (docker · … | local · <prefix>)`.
  If a compile error names a removed/renamed API, it's an old runtime version (not your code) —
  refresh it (`--pull`, or rebuild the local prefix), don't rewrite correct code.
- **exit codes**: `0` ok · `10` compile error in *your* code (stderr carries
  `{"phase":"compile","message":...,"sourceLine":N}` — fix that line) · `11` render
  error · `12` Docker unavailable (run `--pull`, or start Docker) · `13` no usable runtime
  (from a render: the selected local runtime is missing its DALi prefix / `g++` / `Xvfb` /
  `pkg-config` — the stderr message says which; from `doctor`: neither runtime is ready —
  read its `issues`). Pass `--dali-prefix`, set `DESKTOP_PREFIX`, or install the tool.

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

### Building common widgets, and unknown API names
- There's no special Button/TextField you must learn — **compose** from `FlexLayout` / `View`
  panels (`SetCornerRadius`, `SetBackgroundColor`, `SetPadding`, `SetRequestedWidth/Height`)
  with `Label` children. A card, a field, and a button are each just "a coloured rounded
  panel with a label inside."
- A few exact types that are easy to guess wrong: padding/margins take **`Dali::Extents(left,
  right, top, bottom)`** — e.g. `panel.SetPadding(Dali::Extents(24, 24, 16, 16));` (there is no
  `UiPadding`). Colours are `UiColor(0xRRGGBB)`. Sizes use `MATCH_PARENT` / a float.
- **Don't guess exact enum/method names from memory.** If you're unsure (e.g. an alignment
  value), just render — a `10` compile error names the exact symbol *and* the line. Fix and
  re-render. That round-trip is faster than reading SDK headers.

### Images
Use `ImageView::New("assets/photo.jpg")` (or `SetResourceUrl("…")`) with a path **relative to
the preview file** (or an absolute path). The CLI copies the referenced file into the render
so it resolves in **both** runtimes — no manual mounting. An unresolvable or remote
(`http(s)://`) URL renders a **gray placeholder** at the ImageView's size (layout preserved),
so a gray box means the path didn't resolve.

### Using components defined in OTHER files (cross-file)
The CLI renders one preview, but it CAN pull in helpers/types/consts you defined elsewhere:
just `#include "path/to/their_file.h"` (a **relative** path) at the top of your preview file.
The CLI follows your project-local `#include "..."`s (transitively, a few hops), **inlines
those definitions**, and renders — so a preview that calls `MakeCard(...)` defined in
`widgets/card.h` works.

Know the real limits so you don't flounder:
- ✅ **Works:** functions / types / consts that are *header-inlinable* and live in a project
  file you `#include "..."` by relative path, inside this project (the folder with
  `.git`/`package.json`).
- ⚠️ **Silent placeholder:** a symbol the CLI can't find (you didn't `#include` it, or it's
  outside the project) is replaced by a **grey placeholder** so the render still appears. If a
  control shows up as a blank/grey box, you forgot to `#include` its definition.
- ❌ **Not supported:** system `<...>` includes (the runtime provides those), files outside the
  project root, and anything needing real separate-compilation **linking** (a `.cpp` whose
  symbols aren't header-inlinable, templates with out-of-line definitions, etc.).
- 🛠 **A compile error *inside* a helper** surfaces as a `10` error pointing at **that file and
  line** — fix it there, not in the preview.
- For full-fidelity multi-file *app* preview (a screen member-function wired to real
  cross-file view-models), the **DALi Preview VS Code extension** has a more complete slicer.
