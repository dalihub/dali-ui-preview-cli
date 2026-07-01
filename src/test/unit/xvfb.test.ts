import { expect } from 'chai';
import { isXvfbInstalled, startXvfb } from '../../runtime/xvfb';

describe('runtime/xvfb', () => {
  it('isXvfbInstalled returns a boolean (never throws)', () => {
    expect(isXvfbInstalled()).to.be.a('boolean');
  });

  it('exports startXvfb as an async function', () => {
    // The real startXvfb spawns an Xvfb server + polls xdpyinfo, which is slow and
    // environment-dependent (it must NOT run in the unit suite / CI). Its actual
    // behaviour — claim a display in :99..:114, never fall back to :0 — is exercised
    // for real by the local-runtime e2e (tests/e2e/render-modes.sh local).
    expect(startXvfb).to.be.a('function');
  });
});
