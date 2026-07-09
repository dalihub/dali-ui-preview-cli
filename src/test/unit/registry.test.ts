import { expect } from 'chai';
import {
    GHCR_HOST,
    BART_PROXY_HOST,
    IMAGE_REPO_PATH,
    GHCR_IMAGE,
    BART_PROXY_IMAGE,
    alternateImage,
} from '../../registry';

describe('registry', () => {
    it('composes the GHCR and BART proxy images from the shared repo path', () => {
        expect(GHCR_IMAGE).to.equal(`${GHCR_HOST}/${IMAGE_REPO_PATH}`);
        expect(BART_PROXY_IMAGE).to.equal(`${BART_PROXY_HOST}/${IMAGE_REPO_PATH}`);
    });

    it('differs only in the host — the repo path is identical, so switching is a prefix swap', () => {
        expect(GHCR_IMAGE.slice(GHCR_HOST.length)).to.equal(BART_PROXY_IMAGE.slice(BART_PROXY_HOST.length));
        expect(GHCR_IMAGE.slice(GHCR_HOST.length)).to.equal(`/${IMAGE_REPO_PATH}`);
    });
});

describe('registry.alternateImage — cross-registry counterpart', () => {
    it('maps BART⇄GHCR preserving the shared repo path', () => {
        expect(alternateImage(BART_PROXY_IMAGE)).to.equal(GHCR_IMAGE);
        expect(alternateImage(GHCR_IMAGE)).to.equal(BART_PROXY_IMAGE);
    });

    it('swaps only the host, keeping any repo path', () => {
        expect(alternateImage(`${GHCR_HOST}/foo/bar`)).to.equal(`${BART_PROXY_HOST}/foo/bar`);
    });

    it('returns undefined for a custom/unknown registry or a bare name', () => {
        expect(alternateImage('docker.io/library/ubuntu')).to.equal(undefined);
        expect(alternateImage('ubuntu')).to.equal(undefined);
    });

    it('round-trips for both known hosts', () => {
        expect(alternateImage(alternateImage(GHCR_IMAGE) as string)).to.equal(GHCR_IMAGE);
        expect(alternateImage(alternateImage(BART_PROXY_IMAGE) as string)).to.equal(BART_PROXY_IMAGE);
    });
});
