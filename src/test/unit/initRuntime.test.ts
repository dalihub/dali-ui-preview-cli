import { expect } from 'chai';
import { chooseRuntime } from '../../init';

describe('init chooseRuntime', () => {
  it('honors an explicit local flag', () => {
    expect(chooseRuntime({ flagged: 'local', dockerOk: true, localReady: false })).to.equal('local');
  });
  it('honors an explicit docker flag', () => {
    expect(chooseRuntime({ flagged: 'docker', dockerOk: false, localReady: true })).to.equal('docker');
  });
  it('prefers docker when available and unflagged', () => {
    expect(chooseRuntime({ dockerOk: true, localReady: true })).to.equal('docker');
  });
  it('falls back to local when docker is absent', () => {
    expect(chooseRuntime({ dockerOk: false, localReady: true })).to.equal('local');
  });
  it('returns null when neither is available', () => {
    expect(chooseRuntime({ dockerOk: false, localReady: false })).to.equal(null);
  });
});
