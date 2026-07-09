"use strict";
/*
 * imageManager.ts — runtime-container version management for the
 * dali-ui-preview-cli. Lists, merges, and pulls DALi runtime image tags.
 *
 * The runtime image is `ghcr.io/lwc0917/dali-preview-runtime`. Its tags follow
 * the scheme `dali_<DALiVersion>` (one per DALi release, e.g. `dali_2.5.18`)
 * plus the rolling `latest`. Remote tags come from the GHCR registry (vendored
 * {@link listRemoteTags}); local tags come from `docker images`. A user lists the
 * available versions, then pulls the one they want.
 *
 * Logging convention (project CLAUDE.md, adapted for a CLI): stdout is reserved
 * for the machine contract (the JSON the CLI prints). Everything here that does
 * I/O streams docker's own progress + any diagnostics to STDERR; the structured
 * results are RETURNED to the caller (cli.ts), which owns the stdout emission.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeVersions = mergeVersions;
exports.localTags = localTags;
exports.listVersions = listVersions;
exports.isRollingTag = isRollingTag;
exports.pickFallbackTag = pickFallbackTag;
exports.pullWithFallback = pullWithFallback;
exports.ensureImageWithFallback = ensureImageWithFallback;
exports.analyzePullError = analyzePullError;
exports.describeFailure = describeFailure;
exports.buildDownloadFailureGuidance = buildDownloadFailureGuidance;
exports.tagImage = tagImage;
exports.ensureImageWithRegistryFallback = ensureImageWithRegistryFallback;
exports.pullWithRegistryFallback = pullWithRegistryFallback;
exports.pullImage = pullImage;
const child_process_1 = require("child_process");
const util_1 = require("util");
const registryClient_1 = require("./registryClient");
const registry_1 = require("./registry");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** Parse a `dali_<ver>` tag into its numeric version components, or null if it is not one. */
function parseDaliVersion(tag) {
    const m = /^dali_(\d+(?:\.\d+)*)$/.exec(tag);
    if (m === null) {
        return null;
    }
    return m[1].split('.').map((p) => parseInt(p, 10));
}
/**
 * Component-wise descending compare of two `dali_*` version-part arrays (so
 * `2.5.18` sorts before `2.5.9`, which a plain string compare gets wrong). A
 * shorter-but-equal-prefix version sorts after the longer one (e.g. `2.5` after
 * `2.5.1`).
 */
function compareDaliDescending(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i] ?? -1;
        const bv = b[i] ?? -1;
        if (av !== bv) {
            return bv - av; // descending
        }
    }
    return 0;
}
/**
 * Deterministic tag ordering for {@link mergeVersions} output:
 *   1. `latest` always first;
 *   2. then every `dali_<ver>` tag, by version DESCENDING (newest release first);
 *   3. then any other tags, alphabetically ascending.
 * Total + stable for a fixed input set, so two runs print byte-identical JSON.
 */
function compareTags(a, b) {
    if (a === b) {
        return 0;
    }
    if (a === 'latest') {
        return -1;
    }
    if (b === 'latest') {
        return 1;
    }
    const av = parseDaliVersion(a);
    const bv = parseDaliVersion(b);
    if (av !== null && bv !== null) {
        return compareDaliDescending(av, bv);
    }
    // A dali_* tag outranks a non-dali tag.
    if (av !== null) {
        return -1;
    }
    if (bv !== null) {
        return 1;
    }
    return a < b ? -1 : 1;
}
/**
 * PURE merge of remote + local tag lists into the ordered {@link VersionEntry}
 * array (no I/O — unit-testable). The union of `remoteTags` and `localTags` is
 * taken (so a local-only tag, e.g. one pulled before it was published or after
 * it was deleted upstream, still appears); each entry is marked `local` if it is
 * in `localTags` and `current` if it equals `currentTag`. The result is sorted by
 * {@link compareTags} (latest first, then `dali_*` descending, then others).
 */
function mergeVersions(remoteTags, localTags, currentTag) {
    const localSet = new Set(localTags);
    const allTags = Array.from(new Set([...remoteTags, ...localTags]));
    allTags.sort(compareTags);
    return allTags.map((tag) => ({
        tag,
        local: localSet.has(tag),
        current: tag === currentTag,
    }));
}
/**
 * List the runtime image tags present in the LOCAL docker store via
 * `docker images <image> --format '{{.Tag}}'`. Untagged layers report `<none>`,
 * which is dropped. Resolves to an empty list if docker prints nothing.
 *
 * @throws  Whatever `execFile` rejects with when docker is missing / the daemon
 *          is unreachable; the caller decides whether that is fatal (the
 *          `--list-versions` path tolerates it and still lists remote tags).
 */
async function localTags(image) {
    const { stdout } = await execFileAsync('docker', ['images', image, '--format', '{{.Tag}}']);
    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== '<none>');
}
/**
 * List every known version of the runtime image: merge the remote registry tags
 * ({@link listRemoteTags}) with the local docker tags ({@link localTags}) into the
 * deterministic {@link VersionListing}, marking each tag's `local`/`current`
 * status (via the pure {@link mergeVersions}).
 *
 * The local lookup is best-effort: if `docker images` fails (daemon down), this
 * still returns the remote tags with `local: false` and logs a one-line note to
 * STDERR, so `--list-versions` works offline-from-docker. A registry failure DOES
 * propagate (there is nothing useful to return without it).
 */
async function listVersions(image, currentTag) {
    const remoteTags = await (0, registryClient_1.listRemoteTags)(image);
    let local = [];
    try {
        local = await localTags(image);
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`dali-ui-preview-cli: could not read local docker images (${reason}); ` +
            'reporting remote tags only (local: false).');
    }
    return {
        image,
        current: currentTag,
        versions: mergeVersions(remoteTags, local, currentTag),
    };
}
/**
 * A ROLLING tag — `latest` or a moving `dali_X.Y.Z` — can move on the registry. A caching proxy
 * (the corp BART/Artifactory GHCR mirror) can't serve a mutable tag from cache: it must revalidate
 * the tag against ghcr.io on every pull to check if it moved, and that upstream round-trip fails
 * over the restricted corp egress. An immutable `dali_X.Y.Z-<sha>` never moves, so it is served
 * straight from cache with no upstream call. See {@link pickFallbackTag}.
 */
function isRollingTag(tag) {
    return tag === 'latest' || /^dali_\d+\.\d+\.\d+$/.test(tag);
}
/**
 * When a rolling tag can't be pulled (e.g. `latest` fails on the corp proxy but the SAME image is
 * available under an immutable tag), pick the best CONCRETE fallback from the registry's tag list.
 * Prefer the newest IMMUTABLE `dali_X.Y.Z-<sha>` — the one the proxy reliably serves from cache,
 * exactly the tag users pick manually. Only fall back to a moving `dali_X.Y.Z` (also mutable) when
 * no immutable tag exists. Returns undefined when the list has no usable concrete tag. Pure.
 */
function pickFallbackTag(tags, failedTag) {
    const ver = (t) => {
        const m = /^dali_(\d+)\.(\d+)\.(\d+)/.exec(t);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
    };
    const newest = (arr) => arr.length === 0 ? undefined : [...arr].sort((a, b) => {
        const [av, bv] = [ver(a), ver(b)];
        return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
    })[0];
    const usable = tags.filter((t) => t !== failedTag && ver(t));
    const immutable = usable.filter((t) => /^dali_\d+\.\d+\.\d+-[0-9a-f]{7,}$/.test(t));
    const moving = usable.filter((t) => /^dali_\d+\.\d+\.\d+$/.test(t)); // dali_X.Y.Z (also mutable)
    return newest(immutable) ?? newest(moving);
}
/**
 * Pull `<image>:<tag>`, self-healing a rolling tag a caching proxy can't serve. On the corp
 * BART/Artifactory proxy a MUTABLE tag (`latest` or a moving `dali_X.Y.Z`) fails because the proxy
 * must revalidate it against ghcr.io on every pull and that upstream call fails over the restricted
 * egress; an immutable `dali_X.Y.Z-<sha>` is served straight from cache. So when a ROLLING tag
 * fails, fall back to the newest IMMUTABLE tag ({@link pickFallbackTag}), pull + pin it, and return
 * the tag that actually landed. An immutable tag failing is a real error (rethrown, no fallback).
 */
async function pullWithFallback(image, tag, deps) {
    try {
        await deps.pull(image, tag);
        return tag;
    }
    catch (err) {
        if (!isRollingTag(tag)) {
            throw err;
        }
        const fallback = pickFallbackTag(await deps.listTags(image), tag);
        if (!fallback) {
            throw err;
        }
        deps.warn?.(`'${tag}' could not be pulled (common for a moving tag on a caching proxy); ` +
            `falling back to the pinned version '${fallback}'.`);
        await deps.pull(image, fallback);
        deps.persistTag?.(fallback);
        return fallback;
    }
}
/**
 * Ensure `<image>:<tag>` is available for a render: a no-op if it is already local (docker run will
 * use it), otherwise {@link pullWithFallback}. Returns the tag that is actually available (may
 * differ from a requested rolling tag when the proxy forced an immutable fallback).
 */
async function ensureImageWithFallback(image, tag, deps) {
    if (await deps.hasLocal(image, tag)) {
        return tag;
    }
    return pullWithFallback(image, tag, deps);
}
/**
 * Categorize a docker pull error string. Mirrors the VS Code extension's analyzer
 * so both tools give identical diagnoses. Auth is checked first (GHCR token
 * failures often wrap an httpReadSeeker frame that also trips the network matcher).
 */
function analyzePullError(errorMessage) {
    const lower = errorMessage.toLowerCase();
    if (lower.includes('failed to authorize') || lower.includes('failed to fetch anonymous token') ||
        lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('denied')) {
        return { category: 'auth' };
    }
    if (lower.includes('x509') || lower.includes('certificate signed by unknown authority') ||
        lower.includes('certificate has expired') || lower.includes('certificate is not trusted') ||
        lower.includes('tls: failed to verify')) {
        return { category: 'cert' };
    }
    if (lower.includes('no such host') || lower.includes('server misbehaving') ||
        lower.includes('name resolution') || lower.includes('could not resolve host')) {
        return { category: 'dns' };
    }
    if (lower.includes('connection refused') || lower.includes('connection reset') || lower.includes('timeout') ||
        lower.includes('i/o timeout') || lower.includes('network is unreachable') || lower.includes('no route to host') ||
        lower.includes('tls handshake') || lower.includes('httpreadseeker') || lower.includes('eof')) {
        return { category: 'network' };
    }
    if (lower.includes('not found') || lower.includes('manifest unknown') ||
        lower.includes('manifest not found') || lower.includes('image not found')) {
        return { category: 'notfound' };
    }
    return { category: 'unknown' };
}
/**
 * Host-aware WHY/FIX for one registry's pull failure. The internal BART proxy must
 * be reached DIRECTLY (bypassing the corporate web proxy); ghcr.io must be reached
 * THROUGH it — so the fixes differ by host. Pure/exported for testing.
 */
function describeFailure(category, host) {
    const isBart = host === registry_1.BART_PROXY_HOST;
    switch (category) {
        case 'cert':
            return {
                reason: `Docker daemon does not trust the TLS certificate presented for ${host}.`,
                fix: isBart
                    ? 'The pull is going through the corporate MITM web proxy. Reach Samsung-internal hosts DIRECTLY: add ".samsung.net" to the daemon NO_PROXY (/etc/systemd/system/docker.service.d/http-proxy.conf) and `sudo systemctl restart docker`. (Or install the corporate proxy CA into the system trust store.)'
                    : 'If reaching ghcr.io through the corporate web proxy, install that proxy CA into the SYSTEM trust store (e.g. update-ca-certificates) and `sudo systemctl restart docker`.',
            };
        case 'dns':
            return {
                reason: `Host ${host} did not resolve (DNS).`,
                fix: isBart
                    ? 'The internal BART host only resolves on the Samsung corporate network/VPN. Connect to the corp network/VPN and retry.'
                    : 'DNS for ghcr.io failed — check your network/DNS/proxy settings.',
            };
        case 'network':
            return {
                reason: `Network connection to ${host} was refused/reset/timed out.`,
                fix: isBart
                    ? 'Ensure you are on the corp network and the daemon routes ".samsung.net" DIRECTLY (not via the web proxy): add ".samsung.net" to the daemon NO_PROXY and restart docker.'
                    : 'The daemon may need the corporate HTTP proxy configured (systemd drop-in) to reach the public internet — or ghcr.io is throttling; retry.',
            };
        case 'auth':
            return {
                reason: `${host} returned an authorization error (401/403).`,
                fix: 'Usually transient — retry. If it persists, a proxy may be intercepting the registry token endpoint.',
            };
        case 'notfound':
            return {
                reason: `The requested tag does not exist on ${host}.`,
                fix: 'Pick a different version (e.g. "latest" or "dali_2.5.28"); list them with `dali-ui-preview-cli --list-versions`.',
            };
        default:
            return { reason: `Unexpected error from ${host}.`, fix: 'See the docker output above for the full error.' };
    }
}
/**
 * Compose the full "download failed" guidance across EVERY registry tried
 * (primary + any fallback): names each server, why it failed, and how to fix it.
 * Pure/exported for testing.
 */
function buildDownloadFailureGuidance(attempts) {
    const lines = ['Could not download the DALi runtime image.', ''];
    lines.push(attempts.length > 1 ? `Tried ${attempts.length} registries — all failed:` : 'Tried:');
    for (const a of attempts) {
        const { category } = analyzePullError(a.error);
        const { reason, fix } = describeFailure(category, a.host);
        lines.push(`  • ${a.label} (${a.host})`);
        lines.push(`      Why: ${reason}`);
        lines.push(`      Fix: ${fix}`);
    }
    lines.push('');
    lines.push('The "local" runtime (--runtime local) needs no download and is unaffected.');
    return lines.join('\n');
}
/** Create a local tag alias (`docker tag <source> <target>`). Rejects on failure. */
async function tagImage(source, target) {
    await execFileAsync('docker', ['tag', source, target]);
}
/**
 * Wrap a per-registry pull (`inner` = {@link pullWithFallback} for `--pull`, or
 * {@link ensureImageWithFallback} for a render) with cross-REGISTRY fallback: try the
 * resolved registry, and if it fails ENTIRELY (e.g. the daemon can't reach or trust the
 * BART host — a failure the same-registry TAG fallback can't fix), retry the counterpart
 * (BART⇄GHCR via `deps.alternateImage`). On a fallback success, `deps.tagImage` aliases the
 * fallback image to the resolved name so later renders find it. On total failure, REJECTS
 * with a multi-line, per-registry, actionable guidance Error.
 */
async function withRegistryFallback(image, tag, deps, inner) {
    const msg = (e) => (e instanceof Error ? e.message : String(e));
    const attempts = [];
    const primary = (0, registry_1.describeRegistry)(image);
    try {
        const landed = await inner(image, tag, deps);
        return { image, tag: landed, source: primary.host };
    }
    catch (e1) {
        attempts.push({ label: primary.label, host: primary.host, error: msg(e1) });
    }
    const alt = deps.alternateImage?.(image);
    if (alt) {
        const altDesc = (0, registry_1.describeRegistry)(alt);
        deps.warn?.(`${primary.label} failed — falling back to ${altDesc.label} — ${altDesc.host}`);
        try {
            const landed = await inner(alt, tag, deps);
            if (deps.tagImage) {
                await deps.tagImage(`${alt}:${landed}`, `${image}:${landed}`);
                deps.warn?.(`Tagged ${alt}:${landed} -> ${image}:${landed}`);
            }
            return { image, tag: landed, source: altDesc.host };
        }
        catch (e2) {
            attempts.push({ label: altDesc.label, host: altDesc.host, error: msg(e2) });
        }
    }
    throw new Error(buildDownloadFailureGuidance(attempts));
}
/** {@link ensureImageWithFallback} + cross-registry fallback (render path — no-op if already local). */
function ensureImageWithRegistryFallback(image, tag, deps) {
    return withRegistryFallback(image, tag, deps, ensureImageWithFallback);
}
/** {@link pullWithFallback} + cross-registry fallback (`--pull` path — always pulls, a refresh). */
function pullWithRegistryFallback(image, tag, deps) {
    return withRegistryFallback(image, tag, deps, pullWithFallback);
}
/**
 * Pull `<image>:<tag>` via `docker pull`, streaming docker's own progress to
 * STDERR (stdout is reserved for the CLI's JSON contract). Resolves to
 * `{ ref, ok: true }` on a clean exit 0; rejects with a clear Error on a non-zero
 * exit or a spawn failure (e.g. docker not installed).
 */
function pullImage(image, tag) {
    const ref = `${image}:${tag}`;
    // Tell the user which server the ~290 MB download comes from (stderr — stdout is
    // reserved for the JSON contract). BART proxy on the corp network, else GHCR.
    const src = (0, registry_1.describeRegistry)(image);
    process.stderr.write(`Pulling ${ref}\n  from ${src.label} — ${src.host}\n`);
    return new Promise((resolve, reject) => {
        // inherit stderr → docker's live progress bars go straight to our stderr;
        // pipe docker's STDOUT and forward it to our stderr too, so docker's final
        // "Status:" line never pollutes the CLI's JSON stdout contract.
        const proc = (0, child_process_1.spawn)('docker', ['pull', ref], { stdio: ['ignore', 'pipe', 'inherit'] });
        proc.stdout?.on('data', (c) => { process.stderr.write(c); });
        proc.on('error', (err) => {
            reject(new Error(`failed to spawn docker pull ${ref}: ${err.message}`));
        });
        proc.on('exit', (code) => {
            if (code === 0) {
                resolve({ ref, ok: true });
            }
            else {
                reject(new Error(`docker pull ${ref} failed (exit ${code ?? -1}).`));
            }
        });
    });
}
