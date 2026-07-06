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
import * as https from 'https';

/** Repo path shared by both registries (the only part after the host). */
export const IMAGE_REPO_PATH = 'lwc0917/dali-preview-runtime';
export const GHCR_HOST = 'ghcr.io';
export const BART_PROXY_HOST = 'ghcr-docker-remote.bart.sec.samsung.net';

/** Direct GHCR image — external users / fallback. */
export const GHCR_IMAGE = `${GHCR_HOST}/${IMAGE_REPO_PATH}`;
/** BART GHCR caching-proxy image — Samsung internal network. */
export const BART_PROXY_IMAGE = `${BART_PROXY_HOST}/${IMAGE_REPO_PATH}`;

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
export function isBartProxyReachable(timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
        const req = https.get(`https://${BART_PROXY_HOST}/v2/`, { timeout: timeoutMs }, (res) => {
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
export async function detectDefaultImage(timeoutMs?: number): Promise<string> {
    return (await isBartProxyReachable(timeoutMs)) ? BART_PROXY_IMAGE : GHCR_IMAGE;
}

/**
 * Human-friendly description of WHERE an image is pulled from, for progress output —
 * so a user watching a ~290 MB download understands which server it comes from.
 */
export function describeRegistry(imageName: string): { label: string; host: string } {
    const slash = imageName.indexOf('/');
    const host = slash === -1 ? imageName : imageName.slice(0, slash);
    if (host === BART_PROXY_HOST) {
        return { label: 'BART proxy (Samsung internal)', host };
    }
    if (host === GHCR_HOST) {
        return { label: 'GHCR (GitHub)', host };
    }
    return { label: host, host };
}
