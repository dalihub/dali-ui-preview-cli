# Value & positioning — `dali-ui-preview-cli` in the AI-agent era

## TL;DR

This CLI is a **fast, deterministic verification surface for DALi UI code** — for AI coding agents and
for humans in a terminal. In the agent loop (**write → render → compare → rewrite**) it returns a real
PNG **plus a machine-readable JSON scene tree**, so an agent can *see* and *check* what it built without
deploying to a device. It is a **first-pass filter, not a replacement for on-device validation**, and its
value is highest exactly where DALi lives — **Tizen TV / embedded**, where the "real run" is slow and
hardware is scarce.

> The CLI **is** the agent interface: an agent invokes it and reads its JSON on stdout — no MCP server
> required (see *"Why the CLI is already a complete agent interface"* below).

---

## 1. Isn't running on a real device more accurate? — Yes, but they play different roles

The real device is ground truth. But *render-and-inspect* and *run-on-device* are **complementary
stages** of the loop, not competitors:

| | This CLI (host-side preview) | Real device / Tizen emulator |
|---|---|---|
| **Inner-loop speed** | one screen in ~0.1–1.8s (see `[Perf]` paths) | a Tizen cross-build + deploy/boot costs **minutes**, needs the whole app |
| **Edge states** | render error/empty/loading, locales, sizes, sample data on demand | can only verify states you can navigate to on a live app |
| **Determinism** | fixed PNG + deterministic scene tree → a reproducible baseline for `--baseline`/verify | real GPU/timing/animation add nondeterminism (why host-side snapshot tools like Paparazzi exist) |
| **Fidelity / integration** | *approximation* — headless software raster of the extracted region | **ground truth** — real GPU/fonts/platform/data, real navigation & services |

**Industry signal:** Apple's Xcode 27 (in beta as of mid-2026) gives coding agents *both* — "checking
visual changes with **previews** *and* interacting with the **simulator** in the Device Hub" — as
**co-equal** tools, not one replacing the other. This CLI is the *preview half* of that pair for DALi;
the device/emulator remains the final check.

## 2. Why the CLI is already a complete agent interface (no MCP required)

An AI agent uses this tool by **running the CLI and parsing its JSON on stdout** — that *is* a tool
contract. Any shell-capable agent (Claude Code, Cursor, a project `AGENTS.md` render loop) calls it
directly; **no MCP server is needed** for the core value. The stdin→JSON-stdout interface, exit codes,
and the deterministic scene tree already give an agent everything it needs to render, inspect, and gate.

*(An MCP wrapper could later add auto-discovery for MCP-native hosts, but it is an optional convenience
— not a prerequisite. The CLI is the agent surface today.)*

## 3. What makes the feedback agent-grade (beyond a screenshot)

A raw device screenshot gives an agent **pixels**. This CLI gives **structure**:

- **Deterministic scene tree** — every node's `id` / `type` / `role` / on-screen `bounds` / **source
  line**. Research on UI agents (e.g. SeeAct, and the design of Playwright MCP) finds structured trees
  beat raw pixels for *grounding and verification* — the model knows not just *what* it sees but *where*
  it is and *which source line* produced it.
- **Set-of-Mark overlay** (`--overlay`) — numbered marks on the render so a vision model can refer to
  elements precisely.
- **Verify loop** (`--baseline` / verdict / exit codes) — render-and-check that can *gate* an agent's
  iteration, not just describe it.

This is the durable differentiator: even as emulators get faster (snapshots, device farms), a screenshot
of a running app still doesn't hand the agent a source-mapped structural tree.

## 4. Where the value is highest (and where it isn't)

Preview value scales with how expensive the *real run* is:

- **Web** (real run = a browser tab, ~1s): a component preview is a nice-to-have; agents just drive the
  real browser. **Low** preview value.
- **Native mobile** (build + emulator = minutes): preview wins the tight loop. **Medium–high.**
- **Tizen TV / embedded / cross-compiled** (cross-build + flash, scarce hardware): the real run is slow
  and hardware doesn't sit in a cheap cloud farm — Samsung's own docs note the QEMU TV emulator exists
  "to reduce the inconvenience of testing on a real device," yet is slower than a real TV and diverges
  at the hardware level. **Highest** preview value — this is DALi's domain.

## 5. Honest limits (do not oversell)

- The render is a **headless software raster** (Xvfb + Mesa `llvmpipe`) of the **extracted region** you
  `return` — not the real Tizen runtime, not the whole app. Expect differences in GPU/font/real-data
  behavior. **"Preview green" ≠ "correct on device."** Treat it as a fast filter and validate final
  builds on a real device or the Tizen emulator.
- Integration, navigation, multi-step flows, and real/async data are **out of scope by design** — that's
  what the device run is for.
- No source publishes a measured "preview-green-but-app-broken" rate; the common failure mode across the
  industry is the *inverse* (preview breaks while the app runs fine), which makes preview a safe — if
  sometimes noisy — signal, not a source of shipped bugs.

## See also
- `README.md` / `README.ko.md` — *Why* and *Use it from an AI coding agent*.
- The sibling VS Code extension (`vscode-dali-ui-preview`) — the human-facing live-preview half; its
  `docs/value-and-positioning.md` mirrors this framing.
