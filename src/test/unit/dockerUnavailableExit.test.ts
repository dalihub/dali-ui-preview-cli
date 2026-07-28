/*
 * dockerUnavailableExit.test.ts — the render path must classify "this host has no
 * Docker" as the documented exit 12, not as a generic failure.
 *
 * Regression context: the runtime image is ensured (and auto-pulled) BEFORE
 * `renderInContainerAt` runs its own `docker info` preflight. On a Docker-less host
 * every `docker pull` therefore failed first, and the user saw the multi-registry
 * "Could not download the DALi runtime image" guidance and exit 1 — the real cause
 * ("no Docker") never appeared, and the documented exit 12 was unreachable from a
 * bare render. `ensureImageForRender` closes that gap.
 *
 * Pure: the docker probe and the image ensure are both injected, so no docker,
 * no network, no fs.
 */

import { expect } from 'chai';
import { ensureImageForRender, DOCKER_UNAVAILABLE_MESSAGE, EnsureForRenderDeps } from '../../cli';

const IMG = 'ghcr.io/test/dali-preview-runtime';

/** Deps whose `ensure` succeeds, recording what it was asked for. */
function okDeps(landedTag: string, over: Partial<EnsureForRenderDeps> = {}): EnsureForRenderDeps & { probes: number } {
    const state = { probes: 0 };
    return Object.assign(state, {
        ensure: over.ensure ?? (async () => ({ tag: landedTag })),
        dockerAvailable: over.dockerAvailable ?? (async () => { state.probes++; return true; }),
    });
}

describe('render-path Docker classification', () => {
    it('returns the landed tag and never probes docker on the happy path', async () => {
        // The extra `docker info` must cost nothing when the pull works — that is why
        // the probe sits in the catch, not in front of the ensure.
        const deps = okDeps('dali_2.5.29');

        expect(await ensureImageForRender(IMG, 'latest', deps)).to.equal('dali_2.5.29');
        expect(deps.probes).to.equal(0);
    });

    it('propagates a fallback tag chosen by the ensure step', async () => {
        const deps = okDeps('dali_2.5.30.10887-c9bd5b1');

        expect(await ensureImageForRender(IMG, 'latest', deps)).to.equal('dali_2.5.30.10887-c9bd5b1');
    });

    it('rewrites a pull failure on a Docker-less host into the exit-12 message', async () => {
        const deps: EnsureForRenderDeps = {
            ensure: async () => { throw new Error('Could not download the DALi runtime image.'); },
            dockerAvailable: async () => false,
        };

        try {
            await ensureImageForRender(IMG, 'latest', deps);
            expect.fail('expected ensureImageForRender to throw');
        } catch (err) {
            // handleRenderFailure matches /^Docker is not available:/ to return 12.
            expect((err as Error).message).to.equal(DOCKER_UNAVAILABLE_MESSAGE);
            expect((err as Error).message).to.match(/^Docker is not available:/);
        }
    });

    it('keeps the original registry error when Docker IS present', async () => {
        // A genuine network/registry failure must NOT be relabelled as a Docker problem:
        // its multi-registry guidance is the actionable part.
        const original = new Error('Could not download the DALi runtime image.\nTried 2 registries.');
        const deps: EnsureForRenderDeps = {
            ensure: async () => { throw original; },
            dockerAvailable: async () => true,
        };

        try {
            await ensureImageForRender(IMG, 'latest', deps);
            expect.fail('expected ensureImageForRender to throw');
        } catch (err) {
            expect(err).to.equal(original);
            expect((err as Error).message).to.contain('Tried 2 registries');
        }
    });
});
