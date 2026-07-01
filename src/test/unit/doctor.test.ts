/*
 * doctor.test.ts — unit tests for the `doctor` preflight command's PURE report
 * builder (buildDoctorReport). Like `chooseRuntime`, the readiness logic is a pure
 * function over already-probed inputs, so it is tested here with a truth-table and
 * no docker / filesystem / spawning. The async probe (runDoctor) is a thin wrapper
 * over already-tested helpers and is exercised by a manual `doctor` run.
 */

import { expect } from 'chai';
import { buildDoctorReport, DoctorInputs } from '../../doctor';
import { LocalReadiness } from '../../runtime/localRunner';

const IMAGE = 'ghcr.io/lwc0917/dali-preview-runtime';
const TAG = 'latest';

/** A ready local runtime with a resolved prefix. */
const localReady: LocalReadiness = { ready: true, issues: [], prefix: '/opt/dali' };
/** An unready local runtime carrying an actionable issue. */
const localNotReady: LocalReadiness = {
  ready: false,
  issues: ['No DALi install found. Pass --dali-prefix <path>, set DESKTOP_PREFIX, or run `init`.'],
  prefix: null,
};

/** Base inputs; each test overrides what it exercises. */
function inputs(over: Partial<DoctorInputs> = {}): DoctorInputs {
  return {
    dockerOk: false,
    dockerImagePulled: false,
    image: IMAGE,
    tag: TAG,
    local: localNotReady,
    configured: null,
    ...over,
  };
}

describe('doctor buildDoctorReport', () => {
  it('stamps schemaVersion and the full image ref', () => {
    const r = buildDoctorReport(inputs({ dockerOk: true, dockerImagePulled: true }));
    expect(r.schemaVersion).to.equal(1);
    expect(r.runtimes.docker.image).to.equal(`${IMAGE}:${TAG}`);
  });

  it('docker-only ready: ready=true, recommended=docker', () => {
    const r = buildDoctorReport(inputs({ dockerOk: true, dockerImagePulled: true }));
    expect(r.ready).to.equal(true);
    expect(r.recommended).to.equal('docker');
    expect(r.runtimes.docker.available).to.equal(true);
    expect(r.runtimes.docker.issues).to.deep.equal([]);
    expect(r.runtimes.local.available).to.equal(false);
    expect(r.runtimes.local.issues.length).to.be.greaterThan(0);
  });

  it('local-only ready: ready=true, recommended=local, prefix surfaced', () => {
    const r = buildDoctorReport(inputs({ dockerOk: false, local: localReady }));
    expect(r.ready).to.equal(true);
    expect(r.recommended).to.equal('local');
    expect(r.runtimes.local.available).to.equal(true);
    expect(r.runtimes.local.prefix).to.equal('/opt/dali');
    expect(r.runtimes.local.issues).to.deep.equal([]);
  });

  it('both ready and unflagged: prefers docker', () => {
    const r = buildDoctorReport(inputs({ dockerOk: true, dockerImagePulled: true, local: localReady }));
    expect(r.ready).to.equal(true);
    expect(r.recommended).to.equal('docker');
  });

  it('neither ready: ready=false, recommended=null, both carry issues', () => {
    const r = buildDoctorReport(inputs({ dockerOk: false, local: localNotReady }));
    expect(r.ready).to.equal(false);
    expect(r.recommended).to.equal(null);
    expect(r.runtimes.docker.available).to.equal(false);
    expect(r.runtimes.docker.issues.length).to.be.greaterThan(0);
    expect(r.runtimes.local.issues.length).to.be.greaterThan(0);
  });

  it('docker up but image not pulled: still ready (first render auto-pulls), imagePulled=false', () => {
    const r = buildDoctorReport(inputs({ dockerOk: true, dockerImagePulled: false }));
    expect(r.ready).to.equal(true);
    expect(r.recommended).to.equal('docker');
    expect(r.runtimes.docker.imagePulled).to.equal(false);
    expect(r.runtimes.docker.issues).to.deep.equal([]);
  });

  it('configured=local wins over docker when local is available', () => {
    const r = buildDoctorReport(
      inputs({ dockerOk: true, dockerImagePulled: true, local: localReady, configured: 'local' }),
    );
    expect(r.configured).to.equal('local');
    expect(r.recommended).to.equal('local');
  });

  it('configured=local but local unavailable: recommended falls back to an available runtime', () => {
    const r = buildDoctorReport(
      inputs({ dockerOk: true, dockerImagePulled: true, local: localNotReady, configured: 'local' }),
    );
    expect(r.configured).to.equal('local');
    expect(r.recommended).to.equal('docker');
  });

  it('configured=docker but docker down, local ready: recommended falls back to local', () => {
    const r = buildDoctorReport(
      inputs({ dockerOk: false, local: localReady, configured: 'docker' }),
    );
    expect(r.configured).to.equal('docker');
    expect(r.recommended).to.equal('local');
  });
});
