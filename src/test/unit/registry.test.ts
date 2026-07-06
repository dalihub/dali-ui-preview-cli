import { expect } from 'chai';
import {
    GHCR_HOST,
    BART_PROXY_HOST,
    IMAGE_REPO_PATH,
    GHCR_IMAGE,
    BART_PROXY_IMAGE,
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
