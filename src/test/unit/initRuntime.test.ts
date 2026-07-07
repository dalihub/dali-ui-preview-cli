import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chooseRuntime, ensureGitignore } from '../../init';

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

describe('init ensureGitignore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-gi-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates .gitignore with the .dali/ entry when absent', () => {
    expect(ensureGitignore(dir)).to.equal('created');
    const body = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(body).to.match(/^\.dali\/$/m);
  });

  it('appends .dali/ to an existing .gitignore, preserving prior content', () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\nout/');
    expect(ensureGitignore(dir)).to.equal('updated');
    const body = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(body).to.match(/^node_modules\/$/m);
    expect(body).to.match(/^out\/$/m);
    expect(body).to.match(/^\.dali\/$/m);
  });

  it('is idempotent — does not duplicate when .dali/ is already ignored', () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'foo\n.dali/\nbar\n');
    expect(ensureGitignore(dir)).to.equal('present');
    const body = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(body.match(/^\.dali\/$/gm)).to.have.length(1);
  });

  it('recognizes the bare `.dali` form too (no trailing slash)', () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), '.dali\n');
    expect(ensureGitignore(dir)).to.equal('present');
  });
});
