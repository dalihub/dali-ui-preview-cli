# Windows / WSL2 compatibility — dali-ui-preview-cli

> Written 2026-07-10. **Internal maintainer feasibility assessment.**
>
> **STATUS: Windows / WSL is NOT an officially supported platform.** This is not a support statement
> or a how-to guide, but an internal compatibility assessment for *if/when* support is considered —
> which is why the user-facing README does not advertise WSL usage.

## TL;DR

| Scenario | Verdict | Why |
|---|---|---|
| **Docker mode inside WSL2 (Ubuntu)** | ✅ **works** (with setup) | The CLI shells out to `docker`; the render is self-contained in the container (internal Xvfb + Mesa `llvmpipe`, no host GPU/X). WSL2 reports `linux`, so the platform gate passes and every Linux code path applies unchanged. |
| **Local (native) mode inside WSL2** | ❌ **blocked on a stock WSL2** | WSLg bind-mounts `/tmp/.X11-unix` read-only, so a managed `Xvfb` cannot create its socket; and local mode needs a from-source DALi prefix built inside the distro (uifw devs only). |
| **Native Windows / macOS (no WSL)** | ⛔ **hard-stops, by design** | `unsupportedPlatformMessage()` exits `14` with a WSL2 hint on `win32`, a Linux-VM hint on `darwin`. This is correct and unit-tested (`src/test/unit/cliPlatform.test.ts`). |

**Bottom line (unsupported today):** technically the CLI is already WSL2-aware and correct at the
platform gate, and Docker mode *would* be the Windows path **if/when** WSL is supported — but it is
**not an officially supported platform yet**. The remaining rough edges are **corporate-network DNS
from WSL** (registry auto-detection) and the **local-mode WSLg limitation** — both environment issues,
not CLI bugs.

> ⚠️ Verified by code + official docs (Microsoft/Docker) + adversarial review, **not** by capturing
> a render on a real Windows 11 + WSL2 host. The container is byte-identical to native Linux, so
> success is near-certain, but "should work", not "observed working".

## What already handles WSL correctly

- **Platform gate.** `cli.ts` `unsupportedPlatformMessage(platform)` returns `null` for `linux`
  (incl. WSL2, which reports `linux`), a WSL2 hint for `win32`, a Linux-VM hint for `darwin`;
  exit code `14`. Unit-tested. `--version`/`--help` still work anywhere.
- **Self-contained render.** `dockerRunner.ts` runs the container with internal Xvfb + `llvmpipe`
  software raster, no host GPU/X/privileged flags — host-independent output.
- **Registry auto-detect.** `registry.ts` probes the BART proxy over HTTPS and falls back to GHCR;
  a flaky/absent resolve simply degrades to GHCR.
- **Shared runtime with the VS Code extension** — same image + named volumes, so a working
  extension setup on the same WSL distro means the CLI needs no extra download.

## Rough edges on WSL2 (environment, not CLI bugs)

| # | Issue | Severity | Fix |
|---|---|---|---|
| W1 | **Corp VPN DNS not propagated to WSL** (default NAT, no DNS tunneling): `*.bart.sec.samsung.net` fails to resolve → BART auto-detect silently degrades to GHCR, which the corp egress throttles for large blobs. | high (old Win) / low (Win11 22H2+) | `%USERPROFILE%\.wslconfig`: `[wsl2] networkingMode=mirrored`, `dnsTunneling=true`; `wsl --shutdown`. Default-on for Win11 22H2 + WSL ≥ 2.2.1. |
| W2 | **Docker Desktop puts the daemon in a separate utility VM**, so the CLI's registry probe (in the distro) and the actual `docker pull` can use different DNS/proxy/CA. Proxy/CA must be set in Docker Desktop's GUI, not the distro. | medium | Enable Docker Desktop WSL integration for the distro; set corp proxy/CA in Docker Desktop Settings → Resources → Proxies / Docker Engine. |
| W3 | **Local mode blocked** by WSLg read-only `/tmp/.X11-unix` + no from-source DALi in-distro. | high (but non-default) | Use Docker mode (the default). Local mode is uifw-developer-only. |
| W4 | **Project on `/mnt/c`** → asset access crosses the 9P boundary (5–10× slower). | low | Keep the project inside the WSL filesystem (`~/…`). |

## Per-tag tag-scheme regression — resolved in v0.11.2

The runtime-release **per-tag release** scheme publishes a 4-segment immutable build key
(`dali_2.5.28.10837-<sha>`) instead of the old 3-segment `dali_2.5.28-<sha>`. An earlier 3-segment-only
parse in `src/imageManager.ts` (`pickFallbackTag`/`isRollingTag`) would have missed the new immutable
tag and degraded the corp-proxy self-heal to a mutable tag the BART proxy can't serve. **Fixed in
v0.11.2** — `isRollingTag`, the immutable/moving filters, and the version tuple now accept the optional
4th (build-number) segment (the same approach as the VS Code extension), with 4-segment regression
tests. Kept here only as the record of the extension⇄CLI parity the three-component sync requires.

## Verify checklist (when a WSL2 host is available)
1. Win11 22H2+ / WSL ≥ 2.2.1 / Ubuntu; Docker Desktop with WSL integration on for the distro.
2. (Corp) `.wslconfig` mirrored + dnsTunneling; `nslookup ghcr-docker-remote.bart.sec.samsung.net`.
3. `dali-ui-preview-cli doctor` → both runtimes reported; docker available.
4. Render a `*.preview.dali.cpp`; confirm PNG + the `dali-ui runtime: … (docker · … — GHCR/BART)`
   stderr line; capture it.

## References
- Docker Desktop WSL2: <https://docs.docker.com/desktop/features/wsl/> · best practices <https://docs.docker.com/desktop/features/wsl/best-practices/>
- WSL networking / DNS tunneling: <https://learn.microsoft.com/windows/wsl/networking> · `.wslconfig` <https://learn.microsoft.com/windows/wsl/wsl-config>
