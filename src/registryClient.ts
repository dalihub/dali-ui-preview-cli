// VENDORED from paperclip src/registryClient.ts for the dali-ui-preview-cli (runtime version mgmt).
// Verbatim copy; lists remote GHCR tags via anonymous pull token using node `https` only.

import * as https from 'https';

/** Minimal GET-JSON helper with a single redirect hop and a timeout. */
function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers, timeout: 10_000 }, (res) => {
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
                } catch (e) {
                    reject(e as Error);
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('request timed out')));
        req.on('error', reject);
    });
}

/**
 * List available tags for a GHCR image using an anonymous pull token.
 * Throws on network / parse / auth failure (callers should catch and surface).
 *
 * Only `ghcr.io` is supported today; other registries return an empty list.
 *
 *   imageName = "ghcr.io/lwc0917/dali-preview-runtime"
 *     → token: GET https://ghcr.io/token?scope=repository:<path>:pull
 *     → tags:  GET https://ghcr.io/v2/<path>/tags/list  (Bearer <token>)
 */
export async function listRemoteTags(imageName: string): Promise<string[]> {
    const slash = imageName.indexOf('/');
    if (slash === -1) {
        return [];
    }
    const host = imageName.slice(0, slash);
    const repoPath = imageName.slice(slash + 1);
    if (host !== 'ghcr.io') {
        return [];
    }

    const tokenResp = await getJson(
        `https://ghcr.io/token?scope=repository:${repoPath}:pull&service=ghcr.io`,
    );
    const token = tokenResp?.token;
    if (!token) {
        throw new Error('failed to obtain registry token');
    }

    const tagsResp = await getJson(
        `https://ghcr.io/v2/${repoPath}/tags/list`,
        { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    );
    return Array.isArray(tagsResp?.tags) ? tagsResp.tags : [];
}
