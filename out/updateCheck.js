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
exports.DISABLE_ENV = exports.UPGRADE_SPEC = exports.CLI_REPO = void 0;
exports.parseTagFromLocation = parseTagFromLocation;
exports.isNewerVersion = isNewerVersion;
exports.fetchLatestVersion = fetchLatestVersion;
exports.shouldCheckNow = shouldCheckNow;
exports.maybeNotifyUpdate = maybeNotifyUpdate;
exports.runUpgrade = runUpgrade;
/*
 * updateCheck.ts — self-update for the github-installed CLI.
 *
 * The CLI is installed via `npm i -g github:dalihub/dali-ui-preview-cli`, which npm does
 * NOT auto-update. This module fills that gap two ways, mirroring the VS Code extension:
 *   • a throttled (once/day) fail-silent version check that prints a one-line stderr NOTICE
 *     when a newer release exists (never touches stdout — the JSON contract is sacred);
 *   • an `upgrade` command that runs the one-line github-install to self-update.
 *
 * Uses github.com (NOT the rate-limited api.github.com) — the `releases/latest` page
 * 302-redirects to `.../tag/<tag>`, and reading that redirect needs no token and survives
 * the shared corporate proxy. Everything here is best-effort: a network hiccup, an offline
 * or egress-blocked runner (e.g. the AI-fix sandbox), or a bad parse never fails a command.
 */
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
/** The repo the CLI is installed from (the github: spec `npm i -g` uses). */
exports.CLI_REPO = 'dalihub/dali-ui-preview-cli';
/** The exact `npm i -g` spec that installs the latest release (main == latest release). */
exports.UPGRADE_SPEC = `github:${exports.CLI_REPO}`;
const RELEASES_LATEST_URL = `https://github.com/${exports.CLI_REPO}/releases/latest`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** Set this env to any non-empty value to disable the once/day update check (e.g. for an agent). */
exports.DISABLE_ENV = 'DALI_PREVIEW_NO_UPDATE_CHECK';
/** Parse the release tag from a `releases/latest` redirect Location (…/tag/v1.2.3 → v1.2.3). */
function parseTagFromLocation(location) {
    if (!location) {
        return null;
    }
    const m = location.match(/\/tag\/([^/?#]+)/);
    return m ? m[1] : null;
}
/** True iff `latest` is strictly newer than `current` (dotted numeric, ignores a leading `v`).
 *  Fail-safe: unparseable input → false, so a malformed tag never nags with a phantom update. */
function isNewerVersion(latest, current) {
    const parse = (v) => {
        const c = v.trim().replace(/^v/i, '');
        return /^\d+(\.\d+)*$/.test(c) ? c.split('.').map((n) => parseInt(n, 10)) : null;
    };
    const a = parse(latest);
    const b = parse(current);
    if (!a || !b) {
        return false;
    }
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) {
            return x > y;
        }
    }
    return false;
}
/** Resolve the latest released version (tag minus a leading `v`), or null on any failure. */
function fetchLatestVersion(timeoutMs = 4000) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) {
            settled = true;
            resolve(v);
        } };
        try {
            const req = https.request(RELEASES_LATEST_URL, { method: 'HEAD', headers: { 'User-Agent': 'dali-ui-preview-cli' } }, (res) => {
                const tag = parseTagFromLocation(res.headers.location);
                res.resume();
                done(tag ? tag.replace(/^v/i, '') : null);
            });
            req.setTimeout(timeoutMs, () => { req.destroy(); done(null); });
            req.on('error', () => done(null));
            req.end();
        }
        catch {
            done(null);
        }
    });
}
const stampFile = () => path.join(os.homedir() || os.tmpdir(), '.cache', 'dali-ui-preview-cli', 'last-update-check');
/** True iff the once/day throttle has elapsed (or no stamp yet). Records "now" as a side effect. */
function shouldCheckNow(now, lastCheck) {
    return lastCheck === null || now - lastCheck >= ONE_DAY_MS;
}
function readStamp() {
    try {
        return parseInt(fs.readFileSync(stampFile(), 'utf8').trim(), 10) || null;
    }
    catch {
        return null;
    }
}
function writeStamp(now) {
    try {
        fs.mkdirSync(path.dirname(stampFile()), { recursive: true });
        fs.writeFileSync(stampFile(), String(now));
    }
    catch { /* best-effort */ }
}
/**
 * Once/day, fail-silent: if a newer release exists, print a one-line NOTICE to STDERR
 * (stdout is the machine contract). No-op when disabled via {@link DISABLE_ENV}, within the
 * throttle window, offline, or on a parse failure. `deps` injectable for tests.
 */
async function maybeNotifyUpdate(currentVersion, deps = {}) {
    try {
        if (process.env[exports.DISABLE_ENV]) {
            return;
        }
        const now = deps.now ?? Date.now();
        if (!shouldCheckNow(now, (deps.readLastCheck ?? readStamp)())) {
            return;
        }
        (deps.recordCheck ?? writeStamp)(now); // record BEFORE the probe so an offline check still backs off a day
        const latest = await (deps.fetchLatest ?? fetchLatestVersion)();
        if (!latest || !isNewerVersion(latest, currentVersion)) {
            return;
        }
        (deps.log ?? ((m) => process.stderr.write(m + '\n')))(`dali-ui-preview-cli ${latest} is available (you have ${currentVersion}). ` +
            `Update: dali-ui-preview-cli upgrade   (or: npm i -g ${exports.UPGRADE_SPEC})`);
    }
    catch { /* never fail a command over an update check */ }
}
/**
 * `upgrade` command: self-update by re-running the one-line github install. Streams npm's
 * output to stderr and resolves npm's exit code (0 on success). Never throws.
 */
function runUpgrade(_argv) {
    return new Promise((resolve) => {
        process.stderr.write(`Updating dali-ui-preview-cli to the latest release (npm i -g ${exports.UPGRADE_SPEC}) …\n`);
        try {
            const child = (0, child_process_1.spawn)('npm', ['i', '-g', exports.UPGRADE_SPEC], { stdio: ['ignore', 'inherit', 'inherit'] });
            child.on('error', (err) => {
                process.stderr.write(`upgrade failed to start npm: ${String(err)}\n`);
                resolve(1);
            });
            child.on('close', (code) => {
                if (code === 0) {
                    process.stderr.write('dali-ui-preview-cli updated.\n');
                }
                resolve(code ?? 1);
            });
        }
        catch (err) {
            process.stderr.write(`upgrade failed: ${String(err)}\n`);
            resolve(1);
        }
    });
}
