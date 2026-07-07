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
    EnsureDeps,
} from '../../imageManager';

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
