/*
 * imageFallback.test.ts — unit tests for the PURE rolling-tag → immutable fallback
 * helpers used when a mutable tag (`latest` / moving `dali_X.Y.Z`) can't be pulled
 * through the corp BART/Artifactory proxy. The proxy must revalidate a mutable tag
 * against ghcr.io on every pull (that upstream round-trip fails on the restricted
 * corp egress), while an immutable `dali_X.Y.Z-<sha>` is served straight from cache.
 * So the fallback must prefer the newest IMMUTABLE tag. No I/O — plain assertions.
 */

import { expect } from 'chai';
import {
    isRollingTag,
    pickFallbackTag,
    pullWithFallback,
    ensureImageWithFallback,
    pullWithRegistryFallback,
    analyzePullError,
    describeFailure,
    buildDownloadFailureGuidance,
    EnsureDeps,
} from '../../imageManager';
import { alternateImage, GHCR_IMAGE, BART_PROXY_IMAGE, BART_PROXY_HOST, GHCR_HOST } from '../../registry';

const IMG = 'ghcr.io/test/dali-preview-runtime';

/** Build EnsureDeps with recording fakes; `failTags` reject on pull. */
function fakeDeps(over: Partial<EnsureDeps> & { failTags?: string[]; remote?: string[] } = {}): EnsureDeps & { pulled: string[]; pinned: string[] } {
    const pulled: string[] = [];
    const pinned: string[] = [];
    const failTags = over.failTags ?? [];
    const remote = over.remote ?? ['latest', 'dali_2.5.28', 'dali_2.5.28-9d55242'];
    return {
        pulled,
        pinned,
        hasLocal: over.hasLocal ?? (async () => false),
        pull: over.pull ?? (async (_img: string, tag: string) => {
            if (failTags.includes(tag)) { throw new Error(`docker pull ${tag} failed`); }
            pulled.push(tag);
            return { ref: `${IMG}:${tag}`, ok: true } as any;
        }),
        listTags: over.listTags ?? (async () => remote),
        persistTag: over.persistTag ?? ((t: string) => { pinned.push(t); }),
        warn: over.warn ?? (() => {}),
    };
}

describe('isRollingTag', () => {
    it('treats latest and a moving dali_X.Y.Z as rolling (mutable)', () => {
        expect(isRollingTag('latest')).to.equal(true);
        expect(isRollingTag('dali_2.5.28')).to.equal(true);
    });
    it('treats an immutable dali_X.Y.Z-<sha> as NOT rolling', () => {
        expect(isRollingTag('dali_2.5.28-9d55242')).to.equal(false);
    });
});

describe('pickFallbackTag (corp-proxy "latest unavailable" fallback)', () => {
    it('prefers the newest IMMUTABLE tag (the one the proxy serves from cache)', () => {
        // Real registry shape: latest + moving dali_2.5.28 + immutable dali_2.5.28-<sha>.
        // The moving dali_2.5.28 is ALSO mutable → would also fail on the proxy, so the
        // fallback must pick the immutable one (exactly what a user picks manually).
        const tags = ['latest', 'dali_2.5.26', 'dali_2.5.28', 'dali_2.5.28-9d55242', 'dali_2.5.26-aaaaaaa'];
        expect(pickFallbackTag(tags, 'latest')).to.equal('dali_2.5.28-9d55242');
    });

    it('falls back to a moving version tag only when NO immutable tag exists', () => {
        const tags = ['latest', 'dali_2.5.26', 'dali_2.5.28'];
        expect(pickFallbackTag(tags, 'latest')).to.equal('dali_2.5.28');
    });

    it('never returns the tag that just failed', () => {
        expect(pickFallbackTag(['dali_2.5.28', 'dali_2.5.28-9d55242'], 'dali_2.5.28'))
            .to.equal('dali_2.5.28-9d55242');
    });

    it('returns undefined when there is no usable concrete tag', () => {
        expect(pickFallbackTag(['latest'], 'latest')).to.equal(undefined);
        expect(pickFallbackTag([], 'latest')).to.equal(undefined);
    });

    // Regression: the runtime moved to a 4-part dali_X.Y.Z.BUILD[-sha] tag. The old
    // 3-part-only regex matched neither the 4-part immutable nor the pin, silently
    // pinning an OLD 3-part dali_2.5.28 build. Guard 4-part support + build-number sort.
    it('handles 4-part dali_X.Y.Z.BUILD tags and picks the newest immutable', () => {
        const tags = [
            'latest', 'dali_2.5.28', 'dali_2.5.28.10837', 'dali_2.5.28.10837-c9bd5b1', 'dali_2.5.28-a3ede24',
            'dali_2.5.29', 'dali_2.5.29.10863', 'dali_2.5.29.10863-c9bd5b1',
        ];
        expect(pickFallbackTag(tags, 'latest')).to.equal('dali_2.5.29.10863-c9bd5b1');
    });
    it('sorts 4-part tags by BUILD number', () => {
        expect(pickFallbackTag(['dali_2.5.29.10708-aaaaaaa', 'dali_2.5.29.10863-bbbbbbb'], 'latest'))
            .to.equal('dali_2.5.29.10863-bbbbbbb');
    });
    it('classifies 4-part pin as rolling and 4-part -sha as immutable', () => {
        expect(isRollingTag('dali_2.5.29.10863')).to.equal(true);
        expect(isRollingTag('dali_2.5.29.10863-c9bd5b1')).to.equal(false);
    });
});

describe('pullWithFallback', () => {
    it('pulls the requested tag directly when it succeeds (no fallback)', async () => {
        const d = fakeDeps();
        const tag = await pullWithFallback(IMG, 'latest', d);
        expect(tag).to.equal('latest');
        expect(d.pulled).to.deep.equal(['latest']);
        expect(d.pinned).to.deep.equal([]);
    });

    it('on a rolling-tag pull failure, pulls the newest immutable, pins it, and returns it', async () => {
        // latest fails (mutable, proxy can't serve); dali_2.5.28-9d55242 (immutable) succeeds.
        const d = fakeDeps({ failTags: ['latest', 'dali_2.5.28'] });
        const tag = await pullWithFallback(IMG, 'latest', d);
        expect(tag).to.equal('dali_2.5.28-9d55242');
        expect(d.pulled).to.deep.equal(['dali_2.5.28-9d55242']);
        expect(d.pinned).to.deep.equal(['dali_2.5.28-9d55242']);
    });

    it('does NOT fall back when an IMMUTABLE tag fails (that is a real error)', async () => {
        const d = fakeDeps({ failTags: ['dali_2.5.28-9d55242'] });
        let threw = false;
        try { await pullWithFallback(IMG, 'dali_2.5.28-9d55242', d); } catch { threw = true; }
        expect(threw).to.equal(true);
        expect(d.pinned).to.deep.equal([]);
    });

    it('rethrows the original error when no fallback tag exists', async () => {
        const d = fakeDeps({ failTags: ['latest'], remote: ['latest'] });
        let msg = '';
        try { await pullWithFallback(IMG, 'latest', d); } catch (e) { msg = (e as Error).message; }
        expect(msg).to.match(/latest failed/);
    });
});

describe('ensureImageWithFallback', () => {
    it('is a no-op when the image:tag is already present locally (docker run will use it)', async () => {
        const d = fakeDeps({ hasLocal: async () => true });
        const tag = await ensureImageWithFallback(IMG, 'latest', d);
        expect(tag).to.equal('latest');
        expect(d.pulled).to.deep.equal([]);
    });

    it('self-heals a missing rolling tag to the newest immutable (agent bare-render path)', async () => {
        const d = fakeDeps({ hasLocal: async () => false, failTags: ['latest', 'dali_2.5.28'] });
        const tag = await ensureImageWithFallback(IMG, 'latest', d);
        expect(tag).to.equal('dali_2.5.28-9d55242');
        expect(d.pinned).to.deep.equal(['dali_2.5.28-9d55242']);
    });
});

describe('analyzePullError (shared diagnosis)', () => {
    it('classifies auth (first, wins over a wrapping network frame)', () => {
        expect(analyzePullError('received unexpected HTTP status: 401').category).to.equal('auth');
        expect(analyzePullError('httpReadSeeker: failed open: failed to authorize').category).to.equal('auth');
    });
    it('classifies cert / dns / network / notfound / unknown', () => {
        expect(analyzePullError('x509: certificate signed by unknown authority').category).to.equal('cert');
        expect(analyzePullError('dial tcp: lookup ghcr.io: no such host').category).to.equal('dns');
        expect(analyzePullError('dial tcp: i/o timeout').category).to.equal('network');
        expect(analyzePullError('manifest unknown').category).to.equal('notfound');
        expect(analyzePullError('some novel failure').category).to.equal('unknown');
    });
});

describe('describeFailure (host-aware WHY/FIX)', () => {
    it('BART cert failure → bypass the corporate proxy for .samsung.net', () => {
        expect(describeFailure('cert', BART_PROXY_HOST).fix).to.match(/\.samsung\.net/);
    });
    it('GHCR cert failure → install the proxy CA in the system store', () => {
        expect(describeFailure('cert', GHCR_HOST).fix.toLowerCase()).to.match(/ca|trust store/);
    });
    it('BART dns failure → off the corp network/VPN', () => {
        expect(describeFailure('dns', BART_PROXY_HOST).fix.toLowerCase()).to.match(/vpn|corporate network/);
    });
});

describe('buildDownloadFailureGuidance (names every server)', () => {
    it('lists each registry with WHY/FIX and mentions the local runtime', () => {
        const text = buildDownloadFailureGuidance([
            { label: 'BART proxy (Samsung internal)', host: BART_PROXY_HOST, error: 'x509: certificate signed by unknown authority' },
            { label: 'GHCR (GitHub)', host: GHCR_HOST, error: 'dial tcp: i/o timeout' },
        ]);
        expect(text).to.match(/BART proxy \(Samsung internal\)/);
        expect(text).to.match(/GHCR \(GitHub\)/);
        expect(text).to.match(/Why:/);
        expect(text).to.match(/Fix:/);
        expect(text).to.match(/all failed/);
        expect(text.toLowerCase()).to.match(/local.*runtime/);
    });
    it('singular header for a single attempt', () => {
        const t = buildDownloadFailureGuidance([{ label: 'GHCR (GitHub)', host: GHCR_HOST, error: 'manifest unknown' }]);
        expect(t).to.match(/Tried:/);
        expect(t).to.not.match(/registries/);
    });
});

describe('pullWithRegistryFallback (cross-registry BART⇄GHCR fallback)', () => {
    // Deps whose pull FAILS for one host and SUCCEEDS for the other, keyed by image.
    function regDeps(failHosts: string[]): EnsureDeps & { pulled: string[]; tagged: [string, string][] } {
        const pulled: string[] = [];
        const tagged: [string, string][] = [];
        return {
            pulled, tagged,
            hasLocal: async () => false,
            pull: async (image: string, tag: string) => {
                const host = image.slice(0, image.indexOf('/'));
                if (failHosts.includes(host)) { throw new Error('x509: certificate signed by unknown authority'); }
                pulled.push(`${image}:${tag}`);
                return { ref: `${image}:${tag}`, ok: true } as any;
            },
            listTags: async () => ['latest', 'dali_2.5.28-9d55242'],
            alternateImage,
            tagImage: async (s: string, t: string) => { tagged.push([s, t]); },
        } as any;
    }
    // Immutable tag → no tag fallback → only the cross-registry path is exercised.
    const IMMUTABLE = 'dali_2.5.28-9d55242';

    it('falls back to the alternate registry and aliases it to the resolved name', async () => {
        const d = regDeps([BART_PROXY_HOST]); // BART fails, GHCR succeeds
        const res = await pullWithRegistryFallback(BART_PROXY_IMAGE, IMMUTABLE, d);
        expect(res.image).to.equal(BART_PROXY_IMAGE);       // resolved name unchanged (aliased)
        expect(res.tag).to.equal(IMMUTABLE);
        expect(res.source).to.equal(GHCR_HOST);             // bytes came from GHCR
        expect(d.pulled).to.deep.equal([`${GHCR_IMAGE}:${IMMUTABLE}`]);
        expect(d.tagged).to.deep.equal([[`${GHCR_IMAGE}:${IMMUTABLE}`, `${BART_PROXY_IMAGE}:${IMMUTABLE}`]]);
    });

    it('tries the BART mirror FIRST when resolved image is ghcr.io (no wasted ghcr.io attempt)', async () => {
        const d = regDeps([]); // nothing fails — BART must be tried first and win
        const res = await pullWithRegistryFallback(GHCR_IMAGE, IMMUTABLE, d);
        expect(res.image).to.equal(GHCR_IMAGE);              // resolved name unchanged
        expect(res.source).to.equal(BART_PROXY_HOST);        // bytes came from BART (tried first)
        expect(d.pulled).to.deep.equal([`${BART_PROXY_IMAGE}:${IMMUTABLE}`]); // ghcr.io never pulled
        expect(d.tagged).to.deep.equal([[`${BART_PROXY_IMAGE}:${IMMUTABLE}`, `${GHCR_IMAGE}:${IMMUTABLE}`]]);
    });

    it('rejects with multi-registry guidance when BOTH registries fail', async () => {
        const d = regDeps([BART_PROXY_HOST, GHCR_HOST]);
        let msg = '';
        try { await pullWithRegistryFallback(BART_PROXY_IMAGE, IMMUTABLE, d); }
        catch (e) { msg = (e as Error).message; }
        expect(msg).to.match(/all failed/);
        expect(msg).to.match(/BART proxy/);
        expect(msg).to.match(/GHCR/);
        expect(d.tagged).to.deep.equal([]); // nothing aliased
    });

    it('reports a single failure (no fallback) for a custom image with no counterpart', async () => {
        const custom = 'registry.example.com/team/img';
        const d = regDeps(['registry.example.com']);
        let msg = '';
        try { await pullWithRegistryFallback(custom, IMMUTABLE, d); }
        catch (e) { msg = (e as Error).message; }
        expect(msg).to.match(/Tried:/);
        expect(msg).to.not.match(/registries/); // single attempt, no cross-registry
    });
});
