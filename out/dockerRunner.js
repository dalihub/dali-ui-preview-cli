"use strict";
/*
 * dockerRunner.ts — compile + render a templated DALi harness inside the
 * runtime container and read back the produced PNG + scene-tree JSON, for the
 * dali-ui-preview CLI (M0/WU-4).
 *
 * This is a self-contained adaptation of the proven VS Code extension render
 * (paperclip `DockerRuntime.buildAndCapture`). The docker invocation — image,
 * `--rm`, every `-v` mount and `-e` env var, the `/work/source.cpp` argument,
 * and the exit-code + `OK:` stdout success contract — is copied verbatim so the
 * render works first try. The only deliberate differences from the sibling:
 *   - default image is `ghcr.io/lwc0917/dali-preview-runtime` (not dalihub);
 *   - the vscode `getLogger` dependency is dropped — diagnostics go to stderr
 *     via plain `console.error`.
 *
 * In-container contract (docker/entrypoint.sh + preview_harness.cpp.template):
 *   - `/work` is the bind-mounted host workDir.
 *   - The entrypoint receives `/work/preview_harness.cpp` as its first argument
 *     (the basename keeps g++ diagnostics matchable by parseGccErrors — M5/F5.3).
 *   - The binary writes the PNG to the baked-in OUTPUT_PATH (`/work/preview.png`)
 *     and the tree JSON to METADATA_PATH (`/work/tree.json`), then prints
 *     `OK:<png>` to stdout and exits 0. Failure → `CAPTURE_FAILED` / non-zero.
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): stdout is reserved
 * for the machine contract (the JSON node tree, emitted by the caller in WU-5),
 * so this module never writes to stdout — all diagnostics go to stderr.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenderError = exports.DEFAULT_IMAGE_TAG = exports.DEFAULT_DOCKER_IMAGE = void 0;
exports.isDockerAvailable = isDockerAvailable;
exports.renderInContainer = renderInContainer;
exports.renderInContainerAt = renderInContainerAt;
exports.cleanupWorkDir = cleanupWorkDir;
const child_process_1 = require("child_process");
const child_process_2 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const util_1 = require("util");
const registry_1 = require("./registry");
const execFileAsync = (0, util_1.promisify)(child_process_2.execFile);
/** Default runtime image (GHCR). On the corp network the BART proxy is used instead — see registry.ts. */
exports.DEFAULT_DOCKER_IMAGE = registry_1.GHCR_IMAGE;
exports.DEFAULT_IMAGE_TAG = 'latest';
/** Render resolution defaults (mirrors harnessTemplater) — TV FHD. */
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
/** Hard timeout for the container render (compile + Xvfb + capture). */
const DEFAULT_TIMEOUT_MS = 90000;
/** Basename the harness writes inside `/work` (must match METADATA/OUTPUT_PATH). */
const PNG_NAME = 'preview.png';
const TREE_NAME = 'tree.json';
/**
 * Basename of the templated source mounted into `/work` and handed to the
 * entrypoint. It is named `preview_harness.cpp` (not a generic `source.cpp`) so a
 * g++ compile diagnostic reads `…/preview_harness.cpp:N:C: error: …` — the
 * filename the vendored {@link parseGccErrors} matches in default (harness) mode
 * (M5/F5.3). The entrypoint compiles whatever path it is given, so the basename is
 * free to choose.
 */
const SOURCE_NAME = 'preview_harness.cpp';
/**
 * Thrown by {@link renderInContainer} when the container fails to produce a render
 * (M5/F5.3). It carries the RAW container diagnostics so the CLI can run the
 * vendored `parseGccErrors` over them and surface a structured
 * `{phase, message, sourceLine}` to the user:
 *   - `stderr`   — the combined container stdout+stderr (the entrypoint echoes the
 *                  g++ compile log to stdout, so both streams are merged here to
 *                  guarantee the diagnostic is present regardless of which stream
 *                  carried it).
 *   - `exitCode` — the container's exit status (entrypoint: 2 = compile fail).
 *   - `phase`    — `'compile'` when the diagnostics contain a g++ `: error:` line,
 *                  else `'render'` (Xvfb/capture/timeout/spawn failure).
 */
class RenderError extends Error {
    constructor(message, stderr, exitCode, phase) {
        super(message);
        this.name = 'RenderError';
        this.stderr = stderr;
        this.exitCode = exitCode;
        this.phase = phase;
        // Restore the prototype chain so `instanceof RenderError` holds when this
        // module is compiled to ES5/CommonJS (TS `extends Error` caveat).
        Object.setPrototypeOf(this, RenderError.prototype);
    }
}
exports.RenderError = RenderError;
/**
 * Classify a container failure as a compile vs render phase by inspecting the raw
 * diagnostics: a g++ diagnostic line (`<file>:<line>:<col>: error:`) means the
 * compile step failed; anything else (Xvfb start, capture, binary crash, timeout)
 * is a render-phase failure. Matches the `: error:` shape the entrypoint's g++ log
 * uses, mirroring `formatRawError`'s own error-line heuristic.
 */
function classifyPhase(diagnostics) {
    return /:\d+:\d+:\s*error:/.test(diagnostics) ? 'compile' : 'render';
}
/**
 * True iff `docker info` succeeds (CLI installed AND daemon reachable AND the
 * current user has socket access). Mirrors the sibling's availability preflight.
 */
async function isDockerAvailable() {
    try {
        const { stdout } = await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}']);
        return stdout.trim().length > 0;
    }
    catch {
        return false;
    }
}
/** Full image reference (`<image>:<tag>`). */
function imageRef(image, tag) {
    return `${image}:${tag}`;
}
/**
 * Spawn the runtime container with the EXACT mount/env contract from the proven
 * sibling render, streaming stdout/stderr and enforcing a hard timeout.
 */
function dockerRun(args, timeoutMs) {
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
        }, timeoutMs);
        proc.stdout.on('data', (c) => { stdout += c.toString(); });
        proc.stderr.on('data', (c) => { stderr += c.toString(); });
        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve({ exitCode: -1, timedOut, stdout, stderr, spawnError: err });
        });
        proc.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ exitCode: code ?? -1, timedOut, stdout, stderr });
        });
    });
}
/**
 * Compile + render `templatedSource` inside the runtime container and read back
 * the captured PNG and scene-tree JSON.
 *
 * Steps:
 *   1. `docker info` preflight — throw a clear Error if the daemon is unreachable.
 *   2. Create a temp workDir and write `templatedSource` to `<workDir>/source.cpp`.
 *   3. `docker run --rm` with the exact `-v`/`-e` set from the sibling, mounting
 *      workDir→/work and passing `/work/source.cpp`.
 *   4. Success = exit 0 AND an `OK:` line on stdout; otherwise throw with the
 *      captured compile/capture diagnostics.
 *
 * The temp workDir is intentionally left on disk on success so the caller can
 * copy the PNG out; call {@link cleanupWorkDir} afterwards.
 *
 * @param templatedSource  Placeholder-free harness C++ (from `templateHarness`).
 *                         Its baked-in OUTPUT_PATH/METADATA_PATH must point inside
 *                         `/work` (the harness defaults to `/work/preview.png` and
 *                         `/work/tree.json`, which match this mount).
 * @throws  A plain Error if docker is unavailable (the preflight). A
 *          {@link RenderError} (carrying raw `stderr`, `exitCode`, and a
 *          `'compile'|'render'` `phase`) if the container fails to spawn, the
 *          render times out, or compile/capture fails (exit non-zero or no `OK:`
 *          marker) — so the CLI can surface a structured diagnostic (M5/F5.3).
 */
async function renderInContainer(templatedSource, opts = {}) {
    // Back-compat wrapper: create the temp workDir here, then delegate to the
    // workDir-injected implementation. The render dispatcher (render.ts) calls
    // renderInContainerAt directly with a workDir it owns.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-ui-preview-'));
    return renderInContainerAt(templatedSource, workDir, opts);
}
/**
 * Like {@link renderInContainer} but renders into a caller-provided `workDir`
 * (already created). Used by the runtime dispatcher so it can bake the matching
 * `/work/...` output paths into the harness before this runs. The workDir is
 * bind-mounted at `/work`, so the container writes `preview.png` / `tree.json`
 * back into it on the host.
 */
async function renderInContainerAt(templatedSource, workDir, opts = {}) {
    const image = opts.image ?? exports.DEFAULT_DOCKER_IMAGE;
    const tag = opts.tag ?? exports.DEFAULT_IMAGE_TAG;
    const width = opts.width ?? DEFAULT_WIDTH;
    const height = opts.height ?? DEFAULT_HEIGHT;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ref = imageRef(image, tag);
    if (!(await isDockerAvailable())) {
        throw new Error('Docker is not available: `docker info` failed. Ensure Docker is ' +
            'installed, the daemon is running, and the current user can access ' +
            'the Docker socket.');
    }
    const sourcePathHost = path.join(workDir, SOURCE_NAME);
    await fs.promises.writeFile(sourcePathHost, templatedSource, 'utf8');
    // Mount/env set copied verbatim from the proven sibling render
    // (DockerRuntime.buildAndCapture):
    //   - workDir↔/work  : source.cpp in, preview.png + tree.json out.
    //   - dali-preview-ccache         : g++ object cache (CCACHE_DIR=/cache).
    //   - dali-preview-shader-cache   : DALi compiled GLES shader cache.
    //   - EINA_LOG_*  : silence the EFL/eldbus stderr deluge.
    //   - LP_NUM_THREADS / GALLIUM_DRIVER : Mesa llvmpipe software rasterizer.
    const args = [
        'run', '--rm',
        '-v', `${workDir}:/work`,
        '-v', 'dali-preview-ccache:/cache',
        '-v', 'dali-preview-shader-cache:/root/.cache/dali_common_caches',
        '-e', `PREVIEW_WIDTH=${width}`,
        '-e', `PREVIEW_HEIGHT=${height}`,
        '-e', 'EINA_LOG_BACKTRACE=disabled',
        '-e', 'EINA_LOG_LEVELS=eldbus:0,eina_safety:0,eina_log:0',
        '-e', 'LP_NUM_THREADS=0',
        '-e', 'GALLIUM_DRIVER=llvmpipe',
        ref,
        `/work/${SOURCE_NAME}`,
    ];
    const outcome = await dockerRun(args, timeoutMs);
    // The entrypoint echoes the g++ compile log to STDOUT (not stderr), so merge
    // both streams for the diagnostics carried on a RenderError — `parseGccErrors`
    // and `classifyPhase` then see the compile error wherever it landed.
    const diagnostics = [outcome.stdout, outcome.stderr]
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join('\n');
    if (outcome.spawnError) {
        // A spawn failure produces no compile log → render-phase.
        throw new RenderError(`Failed to spawn docker: ${outcome.spawnError.message}`, diagnostics, outcome.exitCode, 'render');
    }
    if (outcome.timedOut) {
        throw new RenderError(`Container render timed out after ${timeoutMs}ms (image ${ref}).`, diagnostics, outcome.exitCode, 'render');
    }
    // DALi's logger emits ANSI color codes; the harness `OK:` marker line is
    // commonly prefixed by a reset sequence ([0m) bleeding from the prior
    // log line, so strip ANSI escapes before testing for the start-of-line marker.
    const cleanStdout = outcome.stdout.replace(/\x1b?\[[0-9;]*[a-zA-Z]/g, '');
    const sawOk = /(^|\n)\s*OK:/.test(cleanStdout);
    if (outcome.exitCode !== 0 || !sawOk) {
        throw new RenderError(`Container render failed (exit ${outcome.exitCode}` +
            `${sawOk ? '' : ', no OK: marker'}) for image ${ref}.` +
            (diagnostics ? `\n${diagnostics}` : ''), diagnostics, outcome.exitCode, classifyPhase(diagnostics));
    }
    const pngPath = path.join(workDir, PNG_NAME);
    const metadataPath = path.join(workDir, TREE_NAME);
    if (!fs.existsSync(pngPath)) {
        // Exit 0 + OK: but no PNG on disk → the capture step failed: render-phase.
        throw new RenderError(`Container reported success but no PNG was produced at ${pngPath}.`, diagnostics, outcome.exitCode, 'render');
    }
    // Tree JSON is consumed by WU-5; read it here so the caller need not. It is
    // best-effort: a missing/unreadable tree must not fail the PNG render.
    let metadataJson = null;
    try {
        metadataJson = await fs.promises.readFile(metadataPath, 'utf8');
    }
    catch {
        metadataJson = null;
    }
    return {
        pngPath,
        metadataPath,
        metadataJson,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        workDir,
    };
}
/**
 * Best-effort recursive removal of a workDir created by {@link renderInContainer}.
 * Never throws — cleanup failures are logged to stderr and otherwise ignored.
 */
function cleanupWorkDir(workDir) {
    try {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`dali-ui-preview: failed to clean up temp dir '${workDir}': ${reason}`);
    }
}
