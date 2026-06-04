/*
 * structuredError.test.ts — unit tests for the M5 structured compile/render error
 * surface (F5.3): the `RenderError` carrier (dockerRunner), the gcc offset math
 * (errorParser, fed a synthetic g++ stderr), and the CLI's `mapRenderError`
 * projection back to the user's absolute source line.
 *
 * Pure string-processing + object construction: no docker / network / compiler.
 * `cli` is imported safely because its `main()` auto-run is guarded by
 * `require.main === module`, so importing it runs no CLI and calls no process.exit.
 */

import { expect } from 'chai';
import { RenderError } from '../../dockerRunner';
import { parseGccErrors } from '../../errorParser';
import { userCodeOffset } from '../../harnessTemplater';
import { mapRenderError } from '../../cli';
import { ResolvedInput } from '../../inputResolver';

/** Minimal ResolvedInput stub: only `code`/`startLine` matter to mapRenderError. */
function resolved(code: string, startLine: number): ResolvedInput {
    return { code, startLine } as ResolvedInput;
}

describe('M5 structured errors (F5.3)', () => {
    describe('RenderError carrier (dockerRunner)', () => {
        it('carries stderr, exitCode and phase, and is an instanceof RenderError/Error', () => {
            const err = new RenderError('boom', 'raw stderr', 2, 'compile');
            expect(err).to.be.instanceOf(RenderError);
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('boom');
            expect(err.stderr).to.equal('raw stderr');
            expect(err.exitCode).to.equal(2);
            expect(err.phase).to.equal('compile');
            expect(err.name).to.equal('RenderError');
        });
    });

    describe('parseGccErrors offset math (synthetic g++ stderr)', () => {
        it('maps a harness diagnostic line back to a 0-based user line via the offset', () => {
            // {{USER_CODE}} on harness line 42; an error on harness line 44 maps to
            // user line 44 - 42 = 2 (0-based). The filename must contain
            // `preview_harness` for the default-mode matcher to accept it — which is
            // exactly the basename dockerRunner mounts (so real g++ output matches).
            const offset = 42;
            const stderr = '/work/preview_harness.cpp:44:1: error: ‘Banana’ has not been declared';
            const errors = parseGccErrors(stderr, offset);

            expect(errors).to.have.lengthOf(1);
            expect(errors[0].line).to.equal(2); // 0-based user line
            expect(errors[0].column).to.equal(1);
            expect(errors[0].severity).to.equal('error');
            expect(errors[0].message).to.equal('‘Banana’ has not been declared');
        });
    });

    describe('cli.mapRenderError', () => {
        it('maps a compile RenderError to {phase, message, sourceLine} with the real template offset + startLine', () => {
            // Use the REAL template offset (what the CLI uses) so the math is the
            // production math. Put the error K=3 user-lines into the user code, with
            // a startLine of 10 → absolute sourceLine = 3 + 10 = 13.
            const offset = userCodeOffset();
            const startLine = 10;
            const userLine = 3; // 0-based, within user code
            const gccLine = offset + userLine;
            const stderr = `/work/preview_harness.cpp:${gccLine}:1: error: expected ';' before '}' token`;
            const err = new RenderError('Container render failed', stderr, 2, 'compile');

            const structured = mapRenderError(err, resolved('return Banana::Nope();', startLine));

            expect(structured.phase).to.equal('compile');
            expect(structured.message).to.equal("expected ';' before '}' token");
            expect(structured.sourceLine).to.equal(userLine + startLine);
        });

        it('falls back to formatRawError + null sourceLine when no g++ line maps (render phase)', () => {
            // A render-phase failure with no mappable g++ diagnostic: sourceLine is
            // null and the message comes from formatRawError (here, the raw first line).
            const err = new RenderError(
                'Container render failed',
                'CAPTURE_FAILED\nXvfb on :99 never became ready',
                4,
                'render',
            );
            const structured = mapRenderError(err, resolved('return X;', 0));

            expect(structured.phase).to.equal('render');
            expect(structured.sourceLine).to.equal(null);
            // formatRawError keeps the first meaningful line when there is no
            // file:line:col error prefix.
            expect(structured.message).to.be.a('string').and.have.length.greaterThan(0);
            expect(structured.message).to.contain('CAPTURE_FAILED');
        });

        it('falls back to null sourceLine when the only g++ error is in harness boilerplate', () => {
            // An error ABOVE the user code (gccLine < offset) maps to a negative line
            // and is dropped by parseGccErrors → no parsed error → null sourceLine.
            const offset = userCodeOffset();
            const boilerplateLine = Math.max(1, offset - 5);
            const stderr = `/work/preview_harness.cpp:${boilerplateLine}:1: error: in boilerplate`;
            const err = new RenderError('Container render failed', stderr, 2, 'compile');

            const structured = mapRenderError(err, resolved('return X;', 0));
            expect(structured.phase).to.equal('compile');
            expect(structured.sourceLine).to.equal(null);
        });
    });
});
