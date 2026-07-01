import { expect } from 'chai';
import { isXvfbInstalled, startXvfb } from '../../runtime/xvfb';

describe('runtime/xvfb', () => {
  it('isXvfbInstalled returns a boolean (never throws)', () => {
    expect(isXvfbInstalled()).to.be.a('boolean');
  });

  it('startXvfb resolves to null when Xvfb is not installed', async function () {
    // Only meaningful on a host WITHOUT Xvfb; where it IS installed this asserts the
    // happy path instead (a session with a stop()). Either way it must never throw
    // and never hand back the real display :0.
    const session = await startXvfb(320, 240);
    if (session === null) {
      expect(isXvfbInstalled()).to.equal(false);
    } else {
      expect(session.display).to.match(/^:\d+$/);
      expect(session.display).to.not.equal(':0');
      session.stop();
    }
  });
});
