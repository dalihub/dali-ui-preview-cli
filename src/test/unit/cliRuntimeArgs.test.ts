import { expect } from 'chai';
import { parseRenderArgs } from '../../cli';

describe('cli runtime args', () => {
  it('parses --runtime local', () => {
    expect(parseRenderArgs(['a.cpp', '--runtime', 'local']).runtime).to.equal('local');
  });
  it('parses --runtime docker', () => {
    expect(parseRenderArgs(['a.cpp', '--runtime', 'docker']).runtime).to.equal('docker');
  });
  it('--local is shorthand for --runtime local', () => {
    expect(parseRenderArgs(['a.cpp', '--local']).runtime).to.equal('local');
  });
  it('parses --dali-prefix', () => {
    expect(parseRenderArgs(['a.cpp', '--dali-prefix', '/opt/dali']).daliPrefix).to.equal('/opt/dali');
  });
  it('leaves runtime undefined when unspecified (docker resolved later)', () => {
    expect(parseRenderArgs(['a.cpp']).runtime).to.equal(undefined);
  });
  it('rejects a bad --runtime value', () => {
    expect(() => parseRenderArgs(['a.cpp', '--runtime', 'podman'])).to.throw(/docker.*local/);
  });
  it('rejects --runtime docker + --local conflict', () => {
    expect(() => parseRenderArgs(['a.cpp', '--runtime', 'docker', '--local'])).to.throw(/conflict/i);
  });
  it('allows --runtime local + --local (agree)', () => {
    expect(parseRenderArgs(['a.cpp', '--runtime', 'local', '--local']).runtime).to.equal('local');
  });
  it('rejects --dali-prefix without a value', () => {
    expect(() => parseRenderArgs(['a.cpp', '--dali-prefix'])).to.throw(/requires a path/);
  });
});
