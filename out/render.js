"use strict";
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
exports.resolveRuntimeMode = resolveRuntimeMode;
exports.render = render;
/*
 * render.ts — runtime-mode resolution + the single render dispatcher. Owns the
 * temp workDir and harness templating, then branches to the Docker or native
 * runner. Both return the identical RenderResult, so callers stay mode-agnostic.
 */
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const harnessTemplater_1 = require("./harnessTemplater");
const dockerRunner_1 = require("./dockerRunner");
const localRunner_1 = require("./runtime/localRunner");
const config_1 = require("./runtime/config");
const imageAssets_1 = require("./runtime/imageAssets");
/**
 * Resolve the runtime mode by precedence: an explicit flag → the
 * `DALI_PREVIEW_RUNTIME` env var → the persisted `.dali/config.json` → default
 * `docker`. Unknown env/config values are ignored (fall through to the default),
 * so a typo can never silently disable Docker.
 */
function resolveRuntimeMode(opts = {}) {
    if (opts.flag === 'docker' || opts.flag === 'local') {
        return opts.flag;
    }
    const env = process.env.DALI_PREVIEW_RUNTIME;
    if (env === 'docker' || env === 'local') {
        return env;
    }
    const cfg = (0, config_1.readConfig)(opts.baseDir ?? process.cwd()).runtime;
    if (cfg === 'docker' || cfg === 'local') {
        return cfg;
    }
    return 'docker';
}
/**
 * Create a temp workDir, template the harness with the mode-appropriate output
 * paths (container `/work/...` for docker, escaped host paths for local), then
 * dispatch to the matching runner. Returns the shared {@link RenderResult}; the
 * caller cleans up `workDir` (via `cleanupWorkDir`).
 */
async function render(mode, userCode, t, r) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-ui-preview-'));
    const pngHost = path.join(workDir, 'preview.png');
    const metaHost = path.join(workDir, 'tree.json');
    // Stage local-file image assets into the workDir so relative/absolute image
    // URLs actually resolve at render time (docker: /work/<name>; local: host path).
    // A no-op when the code references no local images (byte-identical source).
    const { code: stagedCode, referenced } = (0, imageAssets_1.stageImageAssets)(userCode, {
        workDir,
        sourceDir: r.baseDir ?? process.cwd(),
        mode,
    });
    // Only when the preview references images: stage the gray placeholder and
    // register it via SetBrokenImageUrl, so an unresolvable/remote image renders
    // the placeholder at its size instead of nothing. Image-free previews keep the
    // byte-identical `UiConfig::New().Apply();` harness (brokenImageUrl stays undefined).
    const brokenImageUrl = referenced > 0 ? (0, imageAssets_1.stageBrokenImagePlaceholder)(workDir, mode) : undefined;
    if (mode === 'local') {
        const source = (0, harnessTemplater_1.templateHarness)(stagedCode, {
            width: t.width, height: t.height, backgroundColor: t.backgroundColor, globals: t.globals,
            outputPath: (0, localRunner_1.escapeCppString)(pngHost), metadataPath: (0, localRunner_1.escapeCppString)(metaHost),
            brokenImageUrl,
        });
        return (0, localRunner_1.renderNatively)(source, workDir, pngHost, metaHost, {
            width: t.width, height: t.height, timeoutMs: r.timeoutMs, daliPrefix: r.daliPrefix, baseDir: r.baseDir,
        });
    }
    // docker: harness bakes the container /work paths; workDir is bind-mounted at /work.
    const source = (0, harnessTemplater_1.templateHarness)(stagedCode, {
        width: t.width, height: t.height, backgroundColor: t.backgroundColor, globals: t.globals,
        outputPath: '/work/preview.png', metadataPath: '/work/tree.json',
        brokenImageUrl,
    });
    return (0, dockerRunner_1.renderInContainerAt)(source, workDir, {
        image: r.image, tag: r.tag, width: r.width, height: r.height, timeoutMs: r.timeoutMs,
    });
}
