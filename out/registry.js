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
exports.BART_PROXY_IMAGE = exports.GHCR_IMAGE = exports.BART_PROXY_HOST = exports.GHCR_HOST = exports.IMAGE_REPO_PATH = void 0;
exports.isBartProxyReachable = isBartProxyReachable;
exports.detectDefaultImage = detectDefaultImage;
exports.alternateImage = alternateImage;
exports.describeRegistry = describeRegistry;
/*
 * registry.ts — where the DALi Preview runtime image is pulled from.
 *
 * The runtime image lives on GHCR (`ghcr.io/lwc0917/dali-preview-runtime`), published
 * by the release workflow. Inside the Samsung corporate network, direct GHCR pulls
 * intermittently drop — the shared corporate egress IP gets throttled/blocked by
 * GitHub mid-transfer, which is fatal for a multi-hundred-MB image blob. BART mirrors
 * GHCR through an anonymous caching proxy at `ghcr-docker-remote.bart.sec.samsung.net`;
 * the repo path is IDENTICAL on both, so switching registries is purely a host-prefix
 * swap (same tags, same digests).
 *
 * We auto-detect which to use: if the BART proxy host is reachable (i.e. we are on the
 * corporate network) use it, otherwise fall back to GHCR. Detection is a cheap HTTPS
 * probe of the registry `/v2/` endpoint — outside Samsung the host does not even
 * resolve, so the probe fails fast.
 */
const https = __importStar(require("https"));
/** Repo path shared by both registries (the only part after the host). */
exports.IMAGE_REPO_PATH = 'lwc0917/dali-preview-runtime';
exports.GHCR_HOST = 'ghcr.io';
exports.BART_PROXY_HOST = 'ghcr-docker-remote.bart.sec.samsung.net';
/** Direct GHCR image — external users / fallback. */
exports.GHCR_IMAGE = `${exports.GHCR_HOST}/${exports.IMAGE_REPO_PATH}`;
/** BART GHCR caching-proxy image — Samsung internal network. */
exports.BART_PROXY_IMAGE = `${exports.BART_PROXY_HOST}/${exports.IMAGE_REPO_PATH}`;
// Tag listing always reads from ghcr.io regardless of which host we PULL from:
// Artifactory's remote-proxy `/v2/.../tags/list` returns only tags it has already
// cached, and the repo path is identical on both registries. `listRemoteTags`
// (registryClient.ts) enforces this by hardcoding the ghcr.io endpoints for the
// shared repo path, so a BART-proxy image still gets the complete, authoritative
// tag list (small JSON, resilient to the throttling that breaks large blob pulls).
/**
 * True iff the BART GHCR proxy host is reachable (⇒ we are on the corporate network).
 * A single short-timeout HTTPS GET of the registry `/v2/` base: ANY HTTP response
 * (200/401/404/…) means the host is there; a DNS/connect/timeout error means it is not
 * (outside Samsung `bart.sec.samsung.net` does not resolve at all). Never throws.
 */
function isBartProxyReachable(timeoutMs = 2000) {
    return new Promise((resolve) => {
        const req = https.get(`https://${exports.BART_PROXY_HOST}/v2/`, { timeout: timeoutMs }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
    });
}
/** Resolve the default runtime image: the BART proxy when reachable, else GHCR. */
async function detectDefaultImage(timeoutMs) {
    return (await isBartProxyReachable(timeoutMs)) ? exports.BART_PROXY_IMAGE : exports.GHCR_IMAGE;
}
/**
 * The OTHER registry's image for the same repo path — used for cross-registry
 * fallback: if a pull from the auto-detected host fails entirely, retry from its
 * counterpart (BART⇄GHCR, identical repo path/digests, pure host-prefix swap).
 *
 * Returns `undefined` when `imageName` is neither known host (e.g. a fully custom
 * `--runtime-image`): no known counterpart, so the caller reports the single failure.
 */
function alternateImage(imageName) {
    const slash = imageName.indexOf('/');
    if (slash === -1) {
        return undefined;
    }
    const host = imageName.slice(0, slash);
    const repoPath = imageName.slice(slash + 1);
    if (host === exports.BART_PROXY_HOST) {
        return `${exports.GHCR_HOST}/${repoPath}`;
    }
    if (host === exports.GHCR_HOST) {
        return `${exports.BART_PROXY_HOST}/${repoPath}`;
    }
    return undefined;
}
/**
 * Human-friendly description of WHERE an image is pulled from, for progress output —
 * so a user watching a ~290 MB download understands which server it comes from.
 */
function describeRegistry(imageName) {
    const slash = imageName.indexOf('/');
    const host = slash === -1 ? imageName : imageName.slice(0, slash);
    if (host === exports.BART_PROXY_HOST) {
        return { label: 'BART proxy (Samsung internal)', host };
    }
    if (host === exports.GHCR_HOST) {
        return { label: 'GHCR (GitHub)', host };
    }
    return { label: host, host };
}
