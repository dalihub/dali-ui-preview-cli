/*
 * inputResolver.test.ts — unit tests for resolveInput / resolveFromCode (M1/WU-4).
 *
 * File-mode tests use real temp files (fs.mkdtempSync under os.tmpdir()), cleaned
 * up in afterEach. No docker, no network, no rendering. resolveFromStdin is
 * exercised via a stubbed async-iterable process.stdin.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { resolveInput, resolveFromCode, resolveFromStdin } from '../../inputResolver';

describe('inputResolver', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-input-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('resolveInput — preview-file mode', () => {
        it('treats a *.preview.dali.cpp file as pure preview code (startLine 0)', () => {
            const body = '// header comment\nreturn FlexLayout::New().Children({ Label::New("A") });\n';
            const file = path.join(tmpDir, 'hello.preview.dali.cpp');
            fs.writeFileSync(file, body, 'utf8');

            const result = resolveInput(file);
            expect(result.mode).to.equal('preview-file');
            expect(result.startLine).to.equal(0);
            expect(result.code).to.equal(body);
            expect(result.sourcePath).to.equal(file);
        });
    });

    describe('resolveInput — marker mode', () => {
        it('extracts the region between markers with the correct startLine', () => {
            const lines = [
                '#include <dali/dali.h>', // line 0
                'void f() {', // line 1
                '  // @dali-preview-begin', // line 2 (begin marker)
                '  return Label::New("X");', // line 3  <- region start
                '  // @dali-preview-end', // line 4 (end marker)
                '}', // line 5
            ];
            const file = path.join(tmpDir, 'widget.cpp');
            fs.writeFileSync(file, lines.join('\n'), 'utf8');

            const result = resolveInput(file);
            expect(result.mode).to.equal('marker');
            // Region is the single line strictly between the markers.
            expect(result.code).to.equal('  return Label::New("X");');
            // startLine is the 0-based index of the first line after the begin marker.
            expect(result.startLine).to.equal(3);
            expect(result.sourcePath).to.equal(file);
        });

        it('works for a .h file too', () => {
            const lines = [
                '// @dali-preview-begin',
                'return Label::New("H");',
                '// @dali-preview-end',
            ];
            const file = path.join(tmpDir, 'widget.h');
            fs.writeFileSync(file, lines.join('\n'), 'utf8');

            const result = resolveInput(file);
            expect(result.mode).to.equal('marker');
            expect(result.code).to.equal('return Label::New("H");');
            expect(result.startLine).to.equal(1);
        });
    });

    describe('resolveInput — error cases', () => {
        it('throws on a missing file', () => {
            const missing = path.join(tmpDir, 'does-not-exist.preview.dali.cpp');
            expect(() => resolveInput(missing)).to.throw(/Cannot read input file/);
        });

        it('throws on a .cpp with no markers', () => {
            const file = path.join(tmpDir, 'plain.cpp');
            fs.writeFileSync(file, 'int main() { return 0; }\n', 'utf8');
            expect(() => resolveInput(file)).to.throw(/No preview region found/);
        });

        it('throws on an unsupported extension', () => {
            const file = path.join(tmpDir, 'notes.txt');
            fs.writeFileSync(file, 'return Label::New("A");', 'utf8');
            expect(() => resolveInput(file)).to.throw(/Unsupported input/);
        });
    });

    describe('resolveFromCode', () => {
        it('returns inline mode for plain code (startLine 0)', () => {
            const code = 'return FlexLayout::New().Children({ Label::New("A") });';
            const result = resolveFromCode(code);
            expect(result.mode).to.equal('inline');
            expect(result.startLine).to.equal(0);
            expect(result.code).to.equal(code);
            expect(result.sourcePath).to.equal('<code>');
        });

        it('returns marker mode when the code contains a marker pair', () => {
            const code = [
                'prelude line',
                '// @dali-preview-begin',
                'return Label::New("M");',
                '// @dali-preview-end',
                'trailer line',
            ].join('\n');
            const result = resolveFromCode(code);
            expect(result.mode).to.equal('marker');
            expect(result.code).to.equal('return Label::New("M");');
            // begin marker is line 1 → region starts at line 2.
            expect(result.startLine).to.equal(2);
        });

        it('honours a caller-supplied sourcePath label', () => {
            const result = resolveFromCode('return Label::New("A");', '<custom>');
            expect(result.sourcePath).to.equal('<custom>');
        });
    });

    describe('resolveFromStdin', () => {
        let originalStdin: NodeJS.ReadStream;

        afterEach(() => {
            // Restore the real stdin after each stub.
            Object.defineProperty(process, 'stdin', {
                value: originalStdin,
                configurable: true,
            });
        });

        /** Replace process.stdin with a finished readable carrying `text`. */
        function stubStdin(text: string): void {
            originalStdin = process.stdin;
            const stream = Readable.from([Buffer.from(text, 'utf8')]);
            Object.defineProperty(process, 'stdin', {
                value: stream,
                configurable: true,
            });
        }

        it('reads piped plain code and reports mode "stdin"', async () => {
            const code = 'return Label::New("from stdin");';
            stubStdin(code);

            const result = await resolveFromStdin();
            expect(result.mode).to.equal('stdin');
            expect(result.code).to.equal(code);
            expect(result.sourcePath).to.equal('<stdin>');
            expect(result.startLine).to.equal(0);
        });

        it('extracts a marker region from piped text but keeps mode "stdin"', async () => {
            const piped = [
                '// @dali-preview-begin',
                'return Label::New("S");',
                '// @dali-preview-end',
            ].join('\n');
            stubStdin(piped);

            const result = await resolveFromStdin();
            expect(result.mode).to.equal('stdin');
            expect(result.code).to.equal('return Label::New("S");');
            expect(result.startLine).to.equal(1);
        });
    });
});
