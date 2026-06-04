/*
 * imageManager.test.ts — unit tests for the PURE version-merge helper
 * (runtime-container version management). `mergeVersions(remote, local, current)`
 * is I/O-free (no docker / no network), so these are plain array assertions:
 * local/current marking, local-only tag inclusion, and the deterministic sort
 * (latest first, then `dali_*` by version descending, then others).
 *
 * The runtime tags today are `["dali_2.5.18","latest"]`; only `:latest` is local.
 */

import { expect } from 'chai';
import { mergeVersions, VersionEntry } from '../../imageManager';

/** Pull just the ordered tag list out of a versions array (for sort assertions). */
function tags(versions: VersionEntry[]): string[] {
    return versions.map((v) => v.tag);
}

describe('imageManager.mergeVersions (runtime version management)', () => {
    it('marks each remote tag local=true iff it is in the local set, current=true iff it equals currentTag', () => {
        // Today's facts: remote = [dali_2.5.18, latest]; only :latest is local; current = latest.
        const versions = mergeVersions(['dali_2.5.18', 'latest'], ['latest'], 'latest');

        const byTag = new Map(versions.map((v) => [v.tag, v]));
        expect(byTag.get('latest')).to.deep.equal({ tag: 'latest', local: true, current: true });
        expect(byTag.get('dali_2.5.18')).to.deep.equal({
            tag: 'dali_2.5.18',
            local: false,
            current: false,
        });
    });

    it('marks current on a non-latest selected tag (e.g. --image-tag dali_2.5.18)', () => {
        const versions = mergeVersions(['dali_2.5.18', 'latest'], ['dali_2.5.18'], 'dali_2.5.18');
        const byTag = new Map(versions.map((v) => [v.tag, v]));
        expect(byTag.get('dali_2.5.18')).to.deep.equal({
            tag: 'dali_2.5.18',
            local: true,
            current: true,
        });
        // latest is neither local nor current in this scenario.
        expect(byTag.get('latest')).to.deep.equal({ tag: 'latest', local: false, current: false });
    });

    it('includes a LOCAL-ONLY tag (present locally but not in the remote list)', () => {
        // A tag pulled before it was published, or deleted upstream, must still appear.
        const versions = mergeVersions(['latest'], ['latest', 'dali_2.4.0'], 'latest');
        expect(tags(versions)).to.include('dali_2.4.0');
        const byTag = new Map(versions.map((v) => [v.tag, v]));
        expect(byTag.get('dali_2.4.0')).to.deep.equal({
            tag: 'dali_2.4.0',
            local: true,
            current: false,
        });
    });

    it('de-duplicates a tag present in BOTH remote and local (one entry, local=true)', () => {
        const versions = mergeVersions(['latest', 'dali_2.5.18'], ['latest'], 'latest');
        // Exactly two distinct tags, no duplicate `latest`.
        expect(tags(versions)).to.deep.equal(['latest', 'dali_2.5.18']);
        expect(versions).to.have.length(2);
    });

    it('sorts deterministically: latest first, then dali_* by version DESCENDING', () => {
        // Feed the tags out of order to prove the sort, not the input order, decides it.
        const versions = mergeVersions(
            ['dali_2.5.9', 'dali_2.5.18', 'latest', 'dali_2.6.0'],
            [],
            'latest',
        );
        // latest pinned first; then 2.6.0 > 2.5.18 > 2.5.9 (numeric, NOT string — string
        // order would wrongly put 2.5.18 before 2.5.9).
        expect(tags(versions)).to.deep.equal([
            'latest',
            'dali_2.6.0',
            'dali_2.5.18',
            'dali_2.5.9',
        ]);
    });

    it('orders dali_* tags ABOVE non-dali/non-latest tags, which sort last alphabetically', () => {
        const versions = mergeVersions(['edge', 'latest', 'dali_2.5.18', 'beta'], [], 'latest');
        expect(tags(versions)).to.deep.equal(['latest', 'dali_2.5.18', 'beta', 'edge']);
    });

    it('produces byte-identical output across two runs of the same input (determinism)', () => {
        const a = mergeVersions(['dali_2.5.18', 'latest'], ['latest'], 'latest');
        const b = mergeVersions(['latest', 'dali_2.5.18'], ['latest'], 'latest');
        expect(JSON.stringify(a)).to.equal(JSON.stringify(b));
    });

    it('handles an empty remote list (offline registry) by listing local-only tags', () => {
        const versions = mergeVersions([], ['latest', 'dali_2.5.18'], 'latest');
        expect(tags(versions)).to.deep.equal(['latest', 'dali_2.5.18']);
        expect(versions.every((v) => v.local)).to.equal(true);
    });
});
