import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveImageRefAuto } from '../../cli';
import { readConfig } from '../../runtime/config';

type Args = Parameters<typeof resolveImageRefAuto>[0];
const BART = 'ghcr-docker-remote.bart.sec.samsung.net/lwc0917/dali-preview-runtime';

describe('cli resolveImageRefAuto (registry auto-detect + persist)', () => {
  let dir: string;
  const savedEnv = process.env.DALI_PREVIEW_IMAGE;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-auto-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}'); // makes dir a project root
    delete process.env.DALI_PREVIEW_IMAGE;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) { delete process.env.DALI_PREVIEW_IMAGE; }
    else { process.env.DALI_PREVIEW_IMAGE = savedEnv; }
  });

  it('uses an explicit --runtime-image without probing or persisting', async () => {
    let probed = false;
    const ref = await resolveImageRefAuto(
      { image: 'ghcr.io/x/y' } as Args, dir,
      async () => { probed = true; return BART; },
    );
    expect(ref.image).to.equal('ghcr.io/x/y');
    expect(probed).to.equal(false);
    expect(readConfig(dir).image).to.equal(undefined); // nothing persisted
  });

  it('auto-detects AND persists when nothing is configured (init-free)', async () => {
    const ref = await resolveImageRefAuto({} as Args, dir, async () => BART);
    expect(ref.image).to.equal(BART);
    // persisted so the next render / doctor reuses it with no re-probe
    expect(readConfig(dir).image).to.equal(BART);
  });

  it('honors a persisted config image over auto-detect (no re-probe)', async () => {
    fs.mkdirSync(path.join(dir, '.dali'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dali', 'config.json'), JSON.stringify({ image: 'ghcr.io/persisted/img' }));
    let probed = false;
    const ref = await resolveImageRefAuto({} as Args, dir, async () => { probed = true; return BART; });
    expect(ref.image).to.equal('ghcr.io/persisted/img');
    expect(probed).to.equal(false);
  });

  it('preserves an explicit --image-tag through auto-detect', async () => {
    const ref = await resolveImageRefAuto({ imageTag: 'dali_2.5.28' } as Args, dir, async () => BART);
    expect(ref.tag).to.equal('dali_2.5.28');
  });
});
