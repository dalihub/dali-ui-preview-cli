/*
 * harnessTemplater.test.ts — unit tests for templateHarness (M1/WU-4).
 *
 * Reads the real vendored template (server/preview_harness.cpp.template) via the
 * default path; no docker / network / rendering. Asserts the output is fully
 * substituted (no leftover {{...}}), embeds the user code, and carries the M0
 * fixed defaults (in-container paths + 1024/600 resolution).
 */

import { expect } from 'chai';
import { templateHarness } from '../../harnessTemplater';

describe('harnessTemplater.templateHarness', () => {
    it('leaves no remaining {{...}} placeholder after substitution', () => {
        const out = templateHarness('return X;');
        expect(out).to.be.a('string');
        // The module's own safety-net regex: no UPPER_SNAKE placeholder may remain.
        expect(out).to.not.match(/\{\{[A-Z_]+\}\}/);
    });

    it('embeds the verbatim user code', () => {
        const out = templateHarness('return X;');
        expect(out).to.include('return X;');
    });

    it('embeds the in-container output and metadata paths', () => {
        const out = templateHarness('return X;');
        expect(out).to.include('/work/preview.png');
        expect(out).to.include('/work/tree.json');
    });

    it('emits the default 1024x600 resolution as float literals', () => {
        const out = templateHarness('return X;');
        expect(out).to.include('1024');
        expect(out).to.include('600');
        // Width/height are declared `static const float`, so emitted as `<n>.0f`.
        expect(out).to.include('1024.0f');
        expect(out).to.include('600.0f');
    });

    it('inserts user code containing $-patterns literally (no regex interpretation)', () => {
        // `$&`/`$1` must survive verbatim — fillPlaceholder must not treat them as
        // replacement patterns.
        const userCode = 'return Label::New("$& and $1");';
        const out = templateHarness(userCode);
        expect(out).to.include('return Label::New("$& and $1");');
    });

    it('throws a clear error when the template file cannot be read', () => {
        expect(() =>
            templateHarness('return X;', { templatePath: '/no/such/template.cpp.template' }),
        ).to.throw(/Cannot read harness template/);
    });
});
