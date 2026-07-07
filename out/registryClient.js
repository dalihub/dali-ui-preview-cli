"use strict";
// VENDORED from paperclip src/registryClient.ts for the dali-ui-preview-cli (runtime version mgmt).
// Verbatim copy; lists remote GHCR tags via anonymous pull token using node `https` only.
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
exports.listRemoteTags = listRemoteTags;
const https = __importStar(require("https"));
const registry_1 = require("./registry");
/** Minimal GET-JSON helper with a single redirect hop and a timeout. */
function getJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers, timeout: 10000 }, (res) => {
            const status = res.statusCode ?? 0;
            const location = res.headers.location;
            if (status >= 300 && status < 400 && location) {
                res.resume();
                resolve(getJson(location, headers));
                return;
            }
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                if (status !== 200) {
                    reject(new Error(`HTTP ${status} for ${url}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('request timed out')));
        req.on('error', reject);
    });
}
/**
 * List available tags using an anonymous GHCR pull token.
 * Throws on network / parse / auth failure (callers should catch and surface).
 *
 * Accepts both `ghcr.io/<path>` and the BART proxy `ghcr-docker-remote.bart.sec.samsung.net/<path>`
 * (same repo path) — the tag list is ALWAYS read from ghcr.io, because the proxy only
 * lists tags it has already cached. Any other registry returns an empty list.
 *
 *   imageName = "ghcr.io/lwc0917/dali-preview-runtime"  (or the BART proxy equivalent)
 *     → token: GET https://ghcr.io/token?scope=repository:<path>:pull
 *     → tags:  GET https://ghcr.io/v2/<path>/tags/list  (Bearer <token>)
 */
async function listRemoteTags(imageName) {
    const slash = imageName.indexOf('/');
    if (slash === -1) {
        return [];
    }
    const host = imageName.slice(0, slash);
    const repoPath = imageName.slice(slash + 1);
    if (host !== registry_1.GHCR_HOST && host !== registry_1.BART_PROXY_HOST) {
        return [];
    }
    const tokenResp = await getJson(`https://ghcr.io/token?scope=repository:${repoPath}:pull&service=ghcr.io`);
    const token = tokenResp?.token;
    if (!token) {
        throw new Error('failed to obtain registry token');
    }
    const tagsResp = await getJson(`https://ghcr.io/v2/${repoPath}/tags/list`, { Authorization: `Bearer ${token}`, Accept: 'application/json' });
    return Array.isArray(tagsResp?.tags) ? tagsResp.tags : [];
}
