import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stageImageAssets } from '../../runtime/imageAssets';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runtime/imageAssets.stageImageAssets', () => {
  let srcDir: string;
  let workDir: string;
  beforeEach(() => { srcDir = tmp('src-'); workDir = tmp('work-'); });
  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('copies a relative-path asset into workDir and rewrites the URL (docker → /work)', () => {
    fs.mkdirSync(path.join(srcDir, 'assets'));
    fs.writeFileSync(path.join(srcDir, 'assets', 'pic.png'), 'PNGDATA');
    const code = 'ImageView v = ImageView::New("assets/pic.png");';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'docker' });
    expect(r.staged).to.equal(1);
    expect(r.code).to.contain('ImageView::New("/work/pic.png")');
    expect(fs.existsSync(path.join(workDir, 'pic.png'))).to.equal(true);
  });

  it('rewrites to the staged host path for local mode', () => {
    fs.writeFileSync(path.join(srcDir, 'a.jpg'), 'X');
    const code = 'ImageView::New("a.jpg")';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'local' });
    expect(r.staged).to.equal(1);
    expect(r.code).to.contain(`ImageView::New("${path.join(workDir, 'a.jpg')}")`);
  });

  it('resolves an absolute path that exists', () => {
    const abs = path.join(srcDir, 'abs.png');
    fs.writeFileSync(abs, 'X');
    const code = `ImageView::New("${abs}")`;
    const r = stageImageAssets(code, { workDir, sourceDir: '/nowhere', mode: 'docker' });
    expect(r.staged).to.equal(1);
    expect(r.code).to.contain('ImageView::New("/work/abs.png")');
  });

  it('also handles SetResourceUrl(...)', () => {
    fs.writeFileSync(path.join(srcDir, 'r.png'), 'X');
    const code = 'v.SetResourceUrl("r.png");';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'docker' });
    expect(r.staged).to.equal(1);
    expect(r.code).to.contain('SetResourceUrl("/work/r.png")');
  });

  it('leaves remote/custom-scheme URLs untouched', () => {
    const code = 'ImageView::New("https://x.invalid/a.png"); ImageView::New("res://foo");';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'docker' });
    expect(r.staged).to.equal(0);
    expect(r.code).to.equal(code);
  });

  it('leaves an unresolvable local path untouched (placeholder handles it)', () => {
    const code = 'ImageView::New("assets/missing.png")';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'docker' });
    expect(r.staged).to.equal(0);
    expect(r.code).to.equal(code);
  });

  it('is a no-op for code with no image URLs (byte-identical)', () => {
    const code = 'FlexLayout root = FlexLayout::New(); return root;';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'docker' });
    expect(r.staged).to.equal(0);
    expect(r.code).to.equal(code);
  });

  it('stages each distinct URL once even if referenced twice', () => {
    fs.writeFileSync(path.join(srcDir, 'dup.png'), 'X');
    const code = 'ImageView::New("dup.png"); ImageView::New("dup.png");';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'docker' });
    expect(r.staged).to.equal(1);
    expect(r.code.match(/\/work\/dup\.png/g)).to.have.length(2);
  });
});
