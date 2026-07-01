import { expect } from 'chai';
import { resolveRuntimeMode } from '../../render';

describe('resolveRuntimeMode', () => {
  const saved = process.env.DALI_PREVIEW_RUNTIME;
  afterEach(() => {
    if (saved === undefined) { delete process.env.DALI_PREVIEW_RUNTIME; } else { process.env.DALI_PREVIEW_RUNTIME = saved; }
  });

  it('defaults to docker', () => {
    delete process.env.DALI_PREVIEW_RUNTIME;
    expect(resolveRuntimeMode({ baseDir: '/tmp' })).to.equal('docker');
  });
  it('flag beats env', () => {
    process.env.DALI_PREVIEW_RUNTIME = 'docker';
    expect(resolveRuntimeMode({ flag: 'local', baseDir: '/tmp' })).to.equal('local');
  });
  it('env selects local when no flag', () => {
    process.env.DALI_PREVIEW_RUNTIME = 'local';
    expect(resolveRuntimeMode({ baseDir: '/tmp' })).to.equal('local');
  });
  it('ignores a bogus env value', () => {
    process.env.DALI_PREVIEW_RUNTIME = 'banana';
    expect(resolveRuntimeMode({ baseDir: '/tmp' })).to.equal('docker');
  });
});
