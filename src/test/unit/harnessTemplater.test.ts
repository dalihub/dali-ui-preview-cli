/*
 * harnessTemplater.test.ts — unit tests for templateHarness (M1/WU-4).
 *
 * Reads the real vendored template (server/preview_harness.cpp.template) via the
 * default path; no docker / network / rendering. Asserts the output is fully
 * substituted (no leftover {{...}}), embeds the user code, and carries the M0
 * fixed defaults (in-container paths + 1024/600 resolution).
 */

import { expect } from 'chai';
import { templateHarness, userCodeOffset, THEME_BACKGROUND } from '../../harnessTemplater';

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

    // ── M5: theme → background-color substitution (F5.1) ─────────────────────────
    describe('theme → backgroundColor (M5/F5.1)', () => {
        it('substitutes the light theme color into the harness', () => {
            const out = templateHarness('return X;', { backgroundColor: THEME_BACKGROUND.light });
            // The light color is DALi white; it must appear (used for both
            // SetBackgroundColor and the Capture background argument).
            expect(THEME_BACKGROUND.light).to.equal('Dali::Color::WHITE');
            expect(out).to.include('Dali::Color::WHITE');
            expect(out).to.not.include('Dali::Color::BLACK');
        });

        it('defaults to the dark (black) background when no color is given', () => {
            const out = templateHarness('return X;');
            expect(THEME_BACKGROUND.dark).to.equal('Dali::Color::BLACK');
            expect(out).to.include('Dali::Color::BLACK');
        });

        it('exposes both theme colors and they differ', () => {
            expect(THEME_BACKGROUND.dark).to.not.equal(THEME_BACKGROUND.light);
        });
    });

    // ── M5: width/height/dpr → scaled PREVIEW_WIDTH float literal (F5.1) ──────────
    describe('resolution / dpr → PREVIEW_WIDTH/HEIGHT (M5/F5.1)', () => {
        it('emits explicit width/height as float literals', () => {
            const out = templateHarness('return X;', { width: 800, height: 480 });
            expect(out).to.include('800.0f');
            expect(out).to.include('480.0f');
        });

        it('emits the dpr-scaled device dimensions (logical 400x300 @ dpr 2 → 800x600)', () => {
            // The CLI scales logical × dpr into device pixels before calling the
            // templater; mirror that math here (400*2 = 800, 300*2 = 600).
            const out = templateHarness('return X;', { width: 400 * 2, height: 300 * 2 });
            expect(out).to.include('800.0f');
            expect(out).to.include('600.0f');
        });
    });

    // ── M5: userCodeOffset (F5.3) ────────────────────────────────────────────────
    describe('userCodeOffset (M5/F5.3)', () => {
        it('returns the 1-based line of {{USER_CODE}} in the real template', () => {
            const offset = userCodeOffset();
            // The vendored template places {{USER_CODE}} well inside the file (it is
            // preceded by includes + the PREVIEW_WIDTH/HEIGHT decls + the __tag
            // helper), so the offset is a positive integer.
            expect(offset).to.be.a('number');
            expect(offset).to.be.greaterThan(1);
        });

        it('throws a clear error when the template cannot be read', () => {
            expect(() => userCodeOffset('/no/such/template.cpp.template')).to.throw(
                /Cannot read harness template/,
            );
        });
    });
});
