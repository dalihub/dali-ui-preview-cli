import { expect } from 'chai';
import { versionFromTag, UNKNOWN_VERSION } from '../../runtimeVersion';

describe('runtimeVersion versionFromTag', () => {
  it('parses a dali_x.y.z release tag', () => {
    expect(versionFromTag('dali_2.5.28')).to.equal('2.5.28');
  });
  it('parses dash / v-prefixed variants', () => {
    expect(versionFromTag('dali-2.5.28')).to.equal('2.5.28');
    expect(versionFromTag('dali_v2.5.28')).to.equal('2.5.28');
  });
  it('returns null for a rolling tag like latest', () => {
    expect(versionFromTag('latest')).to.equal(null);
  });
  it('returns null for an unrelated tag', () => {
    expect(versionFromTag('main')).to.equal(null);
  });
  it('exposes an unknown-version sentinel string', () => {
    expect(UNKNOWN_VERSION).to.be.a('string');
  });
});
