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
 * Pull `<image>:<tag>` via `docker pull`, streaming docker's own progress to
 * STDERR (stdout is reserved for the CLI's JSON contract). Resolves to
 * `{ ref, ok: true }` on a clean exit 0; rejects with a clear Error on a non-zero
 * exit or a spawn failure (e.g. docker not installed).
 */
export function pullImage(image: string, tag: string): Promise<PullResult> {
    const ref = `${image}:${tag}`;
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
