import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkLocalReadiness, renderNatively, escapeCppString } from '../../runtime/localRunner';

describe('runtime/localRunner', () => {
  it('escapeCppString escapes backslashes and quotes', () => {
    expect(escapeCppString('a\\b"c')).to.equal('a\\\\b\\"c');
  });

  it('renderNatively throws a runtime-unavailable Error when prefix is bogus', async () => {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-'));
    try {
      await renderNatively('int main(){}', wd, path.join(wd, 'p.png'), path.join(wd, 't.json'),
        { daliPrefix: path.join(wd, 'no-dali') });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).to.match(/^Local DALi runtime is not available:/);
    } finally {
      fs.rmSync(wd, { recursive: true, force: true });
    }
  });

  it('checkLocalReadiness reports issues (not ready) for a bogus prefix', () => {
    const r = checkLocalReadiness({ daliPrefix: '/definitely/not/dali' });
    expect(r.ready).to.equal(false);
    expect(r.issues.join(' ')).to.match(/DALi/);
  });
});
