import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readConfig, writeConfig } from '../../runtime/config';

describe('runtime/config', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-cfg-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{}'); // marks project root
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('returns {} when no config exists', () => {
    expect(readConfig(root)).to.deep.equal({});
  });

  it('round-trips a written config found from a nested dir', () => {
    const p = writeConfig(root, { runtime: 'local', daliPrefix: '/opt/dali' });
    expect(fs.existsSync(p)).to.equal(true);
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    expect(readConfig(nested)).to.deep.equal({ runtime: 'local', daliPrefix: '/opt/dali' });
  });

  it('returns {} for malformed JSON instead of throwing', () => {
    fs.mkdirSync(path.join(root, '.dali'), { recursive: true });
    fs.writeFileSync(path.join(root, '.dali', 'config.json'), '{ not json');
    expect(readConfig(root)).to.deep.equal({});
  });

  it('drops unknown/invalid fields on read', () => {
    fs.mkdirSync(path.join(root, '.dali'), { recursive: true });
    fs.writeFileSync(path.join(root, '.dali', 'config.json'),
      JSON.stringify({ runtime: 'podman', daliPrefix: 42, imageTag: 'x', junk: true }));
    expect(readConfig(root)).to.deep.equal({ imageTag: 'x' });
  });
});
