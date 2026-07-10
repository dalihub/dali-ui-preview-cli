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
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

/** The repo the CLI is installed from (the github: spec `npm i -g` uses). */
export const CLI_REPO = 'dalihub/dali-ui-preview-cli';
/** The exact `npm i -g` spec that installs the latest release (main == latest release). */
export const UPGRADE_SPEC = `github:${CLI_REPO}`;
const RELEASES_LATEST_URL = `https://github.com/${CLI_REPO}/releases/latest`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** Set this env to any non-empty value to disable the once/day update check (e.g. for an agent). */
export const DISABLE_ENV = 'DALI_PREVIEW_NO_UPDATE_CHECK';

/** Parse the release tag from a `releases/latest` redirect Location (…/tag/v1.2.3 → v1.2.3). */
export function parseTagFromLocation(location: string | undefined): string | null {
    if (!location) { return null; }
    const m = location.match(/\/tag\/([^/?#]+)/);
    return m ? m[1] : null;
}

/** True iff `latest` is strictly newer than `current` (dotted numeric, ignores a leading `v`).
 *  Fail-safe: unparseable input → false, so a malformed tag never nags with a phantom update. */
export function isNewerVersion(latest: string, current: string): boolean {
    const parse = (v: string): number[] | null => {
        const c = v.trim().replace(/^v/i, '');
        return /^\d+(\.\d+)*$/.test(c) ? c.split('.').map((n) => parseInt(n, 10)) : null;
    };
    const a = parse(latest);
    const b = parse(current);
    if (!a || !b) { return false; }
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) { return x > y; }
    }
    return false;
}

/** Resolve the latest released version (tag minus a leading `v`), or null on any failure. */
export function fetchLatestVersion(timeoutMs = 4000): Promise<string | null> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
        try {
            const req = https.request(
                RELEASES_LATEST_URL,
                { method: 'HEAD', headers: { 'User-Agent': 'dali-ui-preview-cli' } },
                (res) => {
                    const tag = parseTagFromLocation(res.headers.location);
                    res.resume();
                    done(tag ? tag.replace(/^v/i, '') : null);
                },
            );
            req.setTimeout(timeoutMs, () => { req.destroy(); done(null); });
            req.on('error', () => done(null));
            req.end();
        } catch { done(null); }
    });
}

const stampFile = (): string => path.join(os.homedir() || os.tmpdir(), '.cache', 'dali-ui-preview-cli', 'last-update-check');

/** True iff the once/day throttle has elapsed (or no stamp yet). Records "now" as a side effect. */
export function shouldCheckNow(now: number, lastCheck: number | null): boolean {
    return lastCheck === null || now - lastCheck >= ONE_DAY_MS;
}

function readStamp(): number | null {
    try { return parseInt(fs.readFileSync(stampFile(), 'utf8').trim(), 10) || null; } catch { return null; }
}
function writeStamp(now: number): void {
    try { fs.mkdirSync(path.dirname(stampFile()), { recursive: true }); fs.writeFileSync(stampFile(), String(now)); } catch { /* best-effort */ }
}

/**
 * Once/day, fail-silent: if a newer release exists, print a one-line NOTICE to STDERR
 * (stdout is the machine contract). No-op when disabled via {@link DISABLE_ENV}, within the
 * throttle window, offline, or on a parse failure. `deps` injectable for tests.
 */
export async function maybeNotifyUpdate(
    currentVersion: string,
    deps: {
        now?: number;
        fetchLatest?: () => Promise<string | null>;
        log?: (m: string) => void;
        readLastCheck?: () => number | null;
        recordCheck?: (now: number) => void;
    } = {},
): Promise<void> {
    try {
        if (process.env[DISABLE_ENV]) { return; }
        const now = deps.now ?? Date.now();
        if (!shouldCheckNow(now, (deps.readLastCheck ?? readStamp)())) { return; }
        (deps.recordCheck ?? writeStamp)(now); // record BEFORE the probe so an offline check still backs off a day
        const latest = await (deps.fetchLatest ?? fetchLatestVersion)();
        if (!latest || !isNewerVersion(latest, currentVersion)) { return; }
        (deps.log ?? ((m) => process.stderr.write(m + '\n')))(
            `dali-ui-preview-cli ${latest} is available (you have ${currentVersion}). ` +
            `Update: dali-ui-preview-cli upgrade   (or: npm i -g ${UPGRADE_SPEC})`,
        );
    } catch { /* never fail a command over an update check */ }
}

/**
 * `upgrade` command: self-update by re-running the one-line github install. Streams npm's
 * output to stderr and resolves npm's exit code (0 on success). Never throws.
 */
export function runUpgrade(_argv: string[]): Promise<number> {
    return new Promise((resolve) => {
        process.stderr.write(`Updating dali-ui-preview-cli to the latest release (npm i -g ${UPGRADE_SPEC}) …\n`);
        try {
            const child = spawn('npm', ['i', '-g', UPGRADE_SPEC], { stdio: ['ignore', 'inherit', 'inherit'] });
            child.on('error', (err) => {
                process.stderr.write(`upgrade failed to start npm: ${String(err)}\n`);
                resolve(1);
            });
            child.on('close', (code) => {
                if (code === 0) { process.stderr.write('dali-ui-preview-cli updated.\n'); }
                resolve(code ?? 1);
            });
        } catch (err) {
            process.stderr.write(`upgrade failed: ${String(err)}\n`);
            resolve(1);
        }
    });
}
