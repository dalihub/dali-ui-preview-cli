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

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { listRemoteTags } from './registryClient';
import { describeRegistry } from './registry';

const execFileAsync = promisify(execFile);

/** One runtime image tag and its local/current status (a row of {@link listVersions}). */
export interface VersionEntry {
    /** The image tag (e.g. `latest`, `dali_2.5.18`). */
    tag: string;
    /** True when this tag is present in the local docker image store. */
    local: boolean;
    /** True when this tag is the one the CLI would use for a render right now. */
    current: boolean;
}

/** Structured result of {@link listVersions} (printed as the `--list-versions` JSON). */
export interface VersionListing {
    /** The base image name (without tag). */
    image: string;
    /** The currently-selected tag. */
    current: string;
    /** All known tags (remote ∪ local), deterministically ordered (latest first). */
    versions: VersionEntry[];
}

/** Result of {@link pullImage} (printed as the `--pull` JSON). */
export interface PullResult {
    /** The full image reference that was pulled (`<image>:<tag>`). */
    ref: string;
    /** Always true on resolve; the promise rejects on a failed pull instead. */
    ok: true;
}

/** Parse a `dali_<ver>` tag into its numeric version components, or null if it is not one. */
function parseDaliVersion(tag: string): number[] | null {
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
function compareDaliDescending(a: number[], b: number[]): number {
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
function compareTags(a: string, b: string): number {
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
export function mergeVersions(
    remoteTags: string[],
    localTags: string[],
    currentTag: string,
): VersionEntry[] {
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
export async function localTags(image: string): Promise<string[]> {
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
export async function listVersions(image: string, currentTag: string): Promise<VersionListing> {
    const remoteTags = await listRemoteTags(image);
    let local: string[] = [];
    try {
        local = await localTags(image);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
            `dali-ui-preview-cli: could not read local docker images (${reason}); ` +
            'reporting remote tags only (local: false).',
        );
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
export function isRollingTag(tag: string): boolean {
    return tag === 'latest' || /^dali_\d+\.\d+\.\d+$/.test(tag);
}

/**
 * When a rolling tag can't be pulled (e.g. `latest` fails on the corp proxy but the SAME image is
 * available under an immutable tag), pick the best CONCRETE fallback from the registry's tag list.
 * Prefer the newest IMMUTABLE `dali_X.Y.Z-<sha>` — the one the proxy reliably serves from cache,
 * exactly the tag users pick manually. Only fall back to a moving `dali_X.Y.Z` (also mutable) when
 * no immutable tag exists. Returns undefined when the list has no usable concrete tag. Pure.
 */
export function pickFallbackTag(tags: string[], failedTag: string): string | undefined {
    const ver = (t: string): [number, number, number] | undefined => {
        const m = /^dali_(\d+)\.(\d+)\.(\d+)/.exec(t);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
    };
    const newest = (arr: string[]): string | undefined =>
        arr.length === 0 ? undefined : [...arr].sort((a, b) => {
            const [av, bv] = [ver(a)!, ver(b)!];
            return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
        })[0];
    const usable = tags.filter((t) => t !== failedTag && ver(t));
    const immutable = usable.filter((t) => /^dali_\d+\.\d+\.\d+-[0-9a-f]{7,}$/.test(t));
    const moving = usable.filter((t) => /^dali_\d+\.\d+\.\d+$/.test(t)); // dali_X.Y.Z (also mutable)
    return newest(immutable) ?? newest(moving);
}

/** Injectable I/O for {@link pullWithFallback} / {@link ensureImageWithFallback} (so both are
 *  unit-testable without docker or the network). */
export interface EnsureDeps {
    /** True if `<image>:<tag>` is already in the local docker store (docker run won't re-pull). */
    hasLocal: (image: string, tag: string) => Promise<boolean>;
    /** Pull `<image>:<tag>` (rejects on failure). */
    pull: (image: string, tag: string) => Promise<PullResult>;
    /** List the registry's remote tags (for choosing a fallback). */
    listTags: (image: string) => Promise<string[]>;
    /** Persist the chosen fallback tag so subsequent renders reuse it (best-effort). */
    persistTag?: (tag: string) => void;
    /** Emit a human note (to STDERR — stdout is the JSON contract). */
    warn?: (message: string) => void;
}

/**
 * Pull `<image>:<tag>`, self-healing a rolling tag a caching proxy can't serve. On the corp
 * BART/Artifactory proxy a MUTABLE tag (`latest` or a moving `dali_X.Y.Z`) fails because the proxy
 * must revalidate it against ghcr.io on every pull and that upstream call fails over the restricted
 * egress; an immutable `dali_X.Y.Z-<sha>` is served straight from cache. So when a ROLLING tag
 * fails, fall back to the newest IMMUTABLE tag ({@link pickFallbackTag}), pull + pin it, and return
 * the tag that actually landed. An immutable tag failing is a real error (rethrown, no fallback).
 */
export async function pullWithFallback(image: string, tag: string, deps: EnsureDeps): Promise<string> {
    try {
        await deps.pull(image, tag);
        return tag;
    } catch (err) {
        if (!isRollingTag(tag)) { throw err; }
        const fallback = pickFallbackTag(await deps.listTags(image), tag);
        if (!fallback) { throw err; }
        deps.warn?.(
            `'${tag}' could not be pulled (common for a moving tag on a caching proxy); ` +
            `falling back to the pinned version '${fallback}'.`,
        );
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
export async function ensureImageWithFallback(image: string, tag: string, deps: EnsureDeps): Promise<string> {
    if (await deps.hasLocal(image, tag)) { return tag; }
    return pullWithFallback(image, tag, deps);
}

/**
 * Pull `<image>:<tag>` via `docker pull`, streaming docker's own progress to
 * STDERR (stdout is reserved for the CLI's JSON contract). Resolves to
 * `{ ref, ok: true }` on a clean exit 0; rejects with a clear Error on a non-zero
 * exit or a spawn failure (e.g. docker not installed).
 */
export function pullImage(image: string, tag: string): Promise<PullResult> {
    const ref = `${image}:${tag}`;
    // Tell the user which server the ~290 MB download comes from (stderr — stdout is
    // reserved for the JSON contract). BART proxy on the corp network, else GHCR.
    const src = describeRegistry(image);
    process.stderr.write(`Pulling ${ref}\n  from ${src.label} — ${src.host}\n`);
    return new Promise<PullResult>((resolve, reject) => {
        // inherit stderr → docker's live progress bars go straight to our stderr;
        // pipe docker's STDOUT and forward it to our stderr too, so docker's final
        // "Status:" line never pollutes the CLI's JSON stdout contract.
        const proc = spawn('docker', ['pull', ref], { stdio: ['ignore', 'pipe', 'inherit'] });
        proc.stdout?.on('data', (c: Buffer) => { process.stderr.write(c); });
        proc.on('error', (err) => {
            reject(new Error(`failed to spawn docker pull ${ref}: ${err.message}`));
        });
        proc.on('exit', (code) => {
            if (code === 0) {
                resolve({ ref, ok: true });
            } else {
                reject(new Error(`docker pull ${ref} failed (exit ${code ?? -1}).`));
            }
        });
    });
}
