import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stageImageAssets, stageBrokenImagePlaceholder } from '../../runtime/imageAssets';
import { templateHarness } from '../../harnessTemplater';

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

  it('reports referenced count including remote/unresolvable URLs', () => {
    const code = 'ImageView::New("https://x/a.png"); ImageView::New("missing.png");';
    const r = stageImageAssets(code, { workDir, sourceDir: srcDir, mode: 'docker' });
    expect(r.staged).to.equal(0);
    expect(r.referenced).to.equal(2);
  });
});

describe('runtime/imageAssets.stageBrokenImagePlaceholder', () => {
  let workDir: string;
  beforeEach(() => { workDir = tmp('bwork-'); });
  afterEach(() => fs.rmSync(workDir, { recursive: true, force: true }));

  it('copies the bundled placeholder into workDir (docker → /work path)', () => {
    const p = stageBrokenImagePlaceholder(workDir, 'docker');
    expect(p).to.equal('/work/broken-image-placeholder.png');
    expect(fs.existsSync(path.join(workDir, 'broken-image-placeholder.png'))).to.equal(true);
  });

  it('returns the host path for local mode', () => {
    const p = stageBrokenImagePlaceholder(workDir, 'local');
    expect(p).to.equal(path.join(workDir, 'broken-image-placeholder.png'));
  });
});

describe('harnessTemplater UI_CONFIG_SETUP (broken-image slot)', () => {
  it('keeps the byte-identical UiConfig one-liner when no broken image is set', () => {
    const out = templateHarness('return View::New();', {});
    expect(out).to.contain('UiConfig::New().Apply();');
    expect(out).to.not.contain('SetBrokenImageUrl');
  });

  it('emits SetBrokenImageUrl before Apply() when a broken image URL is given', () => {
    const out = templateHarness('return View::New();', { brokenImageUrl: '/work/broken-image-placeholder.png' });
    expect(out).to.contain('SetBrokenImageUrl(UiConfig::BrokenImageType::NORMAL, "/work/broken-image-placeholder.png")');
    expect(out).to.contain('__uiConfig.Apply();');
    expect(out).to.not.contain('{{UI_CONFIG_SETUP}}');
  });
});
