/*
 * errorParser.test.ts — unit tests for the vendored gcc error parser (M1/WU-4,
 * bonus). Pure string-processing tests: no docker / network / compiler.
 */

import { expect } from 'chai';
import {
    getHarnessCodeOffset,
    parseGccErrors,
    formatRawError,
    detectRuntimeApiSkew,
    ParsedError,
} from '../../errorParser';

describe('errorParser', () => {
    describe('getHarnessCodeOffset', () => {
        it('returns the 1-based line of the {{USER_CODE}} placeholder', () => {
            const template = ['line one', 'line two', '{{USER_CODE}}', 'line four'].join('\n');
            // Placeholder is on the 3rd line (1-based).
            expect(getHarnessCodeOffset(template)).to.equal(3);
        });

        it('returns 0 when no placeholder is present', () => {
            expect(getHarnessCodeOffset('no placeholder here')).to.equal(0);
        });
    });

    describe('parseGccErrors', () => {
        it('maps a harness diagnostic line to a user-relative 0-based ParsedError', () => {
            // {{USER_CODE}} sits on harness line 10; an error on line 12 maps to
            // user line 12 - 10 = 2 (0-based).
            const stderr = '/tmp/x/preview_harness.cpp:12:7: error: expected ; before }';
            const errors = parseGccErrors(stderr, 10);

            expect(errors).to.have.lengthOf(1);
            const e: ParsedError = errors[0];
            expect(e.line).to.equal(2);
            expect(e.column).to.equal(7);
            expect(e.severity).to.equal('error');
            expect(e.message).to.equal('expected ; before }');
        });

        it('skips diagnostics in harness boilerplate above the user code', () => {
            // Error on harness line 3, user code starts at line 10 → mappedLine < 0.
            const stderr = '/tmp/x/preview_harness.cpp:3:1: error: in boilerplate';
            expect(parseGccErrors(stderr, 10)).to.have.lengthOf(0);
        });

        it('ignores lines from files other than preview_harness (default mode)', () => {
            const stderr = '/usr/include/dali/dali.h:99:1: error: unrelated';
            expect(parseGccErrors(stderr, 1)).to.have.lengthOf(0);
        });
    });

    describe('formatRawError', () => {
        it('summarizes an empty input', () => {
            expect(formatRawError('')).to.equal('Build failed (no output).');
            expect(formatRawError('   ')).to.equal('Build failed (no output).');
        });

        it('rewrites a file:line:col error prefix into a "Line N, Col M:" form', () => {
            const raw = '/tmp/dali_preview/preview_harness.cpp:5:3: error: bad token';
            const summary = formatRawError(raw);
            expect(summary).to.equal('Line 5, Col 3: bad token');
        });

        it('prefers the first line containing ": error:"', () => {
            const raw = ['some warning noise', '/x.cpp:2:1: error: the real error', 'trailing'].join(
                '\n',
            );
            expect(formatRawError(raw)).to.equal('Line 2, Col 1: the real error');
        });
    });

    describe('detectRuntimeApiSkew / formatRawError hint', () => {
        const skew = '/tmp/x/preview_harness.cpp:5:3: error: ‘class Dali::Ui::UiConfig’ has no member named ‘SetAlwaysShowFocus’';
        it('detects a runtime-API skew', () => {
            expect(detectRuntimeApiSkew(skew)).to.equal(true);
        });
        it('appends the stale-runtime hint in formatRawError', () => {
            expect(formatRawError(skew)).to.contain('stale DALi runtime');
        });
        it('does not append the hint to an ordinary error', () => {
            expect(formatRawError('/tmp/x/preview_harness.cpp:5:3: error: expected ; before }')).to.not.contain('stale DALi runtime');
        });
    });
});
