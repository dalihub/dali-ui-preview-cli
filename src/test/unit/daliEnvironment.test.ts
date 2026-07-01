import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateDaliPrefix, resolveDaliPrefix, resolvePrefix, checkDependencies } from '../../runtime/daliEnvironment';

function fakePrefix(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-prefix-'));
  const lib = path.join(root, 'lib');
  fs.mkdirSync(path.join(lib, 'pkgconfig'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'libdali2-core.so'), '');
  fs.writeFileSync(path.join(lib, 'pkgconfig', 'dali2-ui-foundation.pc'), '');
  return root;
}

describe('runtime/daliEnvironment', () => {
  it('validateDaliPrefix requires core lib + ui-foundation pc', () => {
    const p = fakePrefix();
    expect(validateDaliPrefix(p)).to.equal(true);
    expect(validateDaliPrefix(path.join(p, 'nope'))).to.equal(false);
  });

  it('resolveDaliPrefix accepts a parent that holds dali-env/opt', () => {
    const inner = fakePrefix();                 // acts as the "opt" prefix
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-parent-'));
    const target = path.join(parent, 'dali-env', 'opt');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(inner, target, { recursive: true });
    expect(resolveDaliPrefix(parent)).to.equal(target);
  });

  it('resolvePrefix honors an explicit override first', () => {
    const p = fakePrefix();
    expect(resolvePrefix({ override: p })).to.equal(p);
    // a bogus override falls through to other sources (never returns the bogus path itself)
    expect(resolvePrefix({ override: path.join(p, 'bad') })).to.not.equal(path.join(p, 'bad'));
  });

  it('resolvePrefix reads DALI_PREVIEW_PREFIX env when no override', () => {
    const p = fakePrefix();
    const saved = process.env.DALI_PREVIEW_PREFIX;
    process.env.DALI_PREVIEW_PREFIX = p;
    try {
      expect(resolvePrefix({})).to.equal(p);
    } finally {
      if (saved === undefined) { delete process.env.DALI_PREVIEW_PREFIX; } else { process.env.DALI_PREVIEW_PREFIX = saved; }
    }
  });

  it('checkDependencies reports booleans for the four tools', () => {
    const d = checkDependencies();
    expect(d).to.have.all.keys('gcc', 'xvfb', 'pkgconfig', 'ccache');
    expect(d.gcc).to.be.a('boolean');
  });
});
