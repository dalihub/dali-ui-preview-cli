import { expect } from 'chai';
import { unsupportedPlatformMessage } from '../../cli';

describe('cli unsupportedPlatformMessage', () => {
  it('returns null on Linux (the only supported platform; WSL2 also reports linux)', () => {
    expect(unsupportedPlatformMessage('linux')).to.equal(null);
  });

  it('flags Windows-native and points at WSL2', () => {
    const msg = unsupportedPlatformMessage('win32');
    expect(msg).to.be.a('string');
    expect(msg).to.match(/Linux \(x86-64\) only/);
    expect(msg).to.match(/WSL2/);
    expect(msg).to.include('win32');
  });

  it('flags macOS with a Linux VM/remote hint (not WSL2)', () => {
    const msg = unsupportedPlatformMessage('darwin');
    expect(msg).to.be.a('string');
    expect(msg).to.match(/Linux VM|remote Linux/);
    expect(msg).to.not.match(/WSL2/);
    expect(msg).to.include('darwin');
  });
});
