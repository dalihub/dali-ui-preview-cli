/*
 * crossFile.test.ts — the cross-file slice path: gather project-local includes
 * (sliceSources) and inline their definitions into the harness globals
 * (sliceBuilder). No docker / rendering here — pure file-walk + string slicing.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveProjectIncludes, findProjectRoot } from '../../sliceSources';
import { buildSlice } from '../../sliceBuilder';

describe('cross-file slice', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xfile-test-')));
        fs.writeFileSync(path.join(dir, 'package.json'), '{}'); // project-root marker
    });
    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    });

    describe('resolveProjectIncludes', () => {
        it('finds a project-local quoted include', () => {
            fs.writeFileSync(path.join(dir, 'card.h'), 'inline int MakeCard(){ return 1; }\n');
            const entry = '#include "card.h"\nreturn MakeCard();\n';
            const names = resolveProjectIncludes(path.join(dir, 'screen.preview.dali.cpp'), entry)
                .map((s) => path.basename(s.path));
            expect(names).to.include('card.h');
        });

        it('follows includes transitively (header → header)', () => {
            fs.writeFileSync(path.join(dir, 'a.h'), '#include "b.h"\n');
            fs.writeFileSync(path.join(dir, 'b.h'), 'inline int B(){ return 2; }\n');
            const names = resolveProjectIncludes(path.join(dir, 'e.preview.dali.cpp'), '#include "a.h"\nreturn B();\n')
                .map((s) => path.basename(s.path));
            expect(names).to.include('a.h');
            expect(names).to.include('b.h');
        });

        it('never reads outside the project root (containment)', () => {
            const escaped = resolveProjectIncludes(path.join(dir, 'e.cpp'), '#include "../../../../../etc/hostname"\n');
            expect(escaped.length).to.equal(0);
        });

        it('ignores system <...> includes (those come from the harness)', () => {
            const sources = resolveProjectIncludes(path.join(dir, 'e.cpp'), '#include <vector>\nreturn {};\n');
            expect(sources.length).to.equal(0);
        });
    });

    describe('buildSlice (cross-file)', () => {
        it('inlines a cross-file helper definition into globals (heuristic rung)', () => {
            fs.writeFileSync(
                path.join(dir, 'card.h'),
                'inline Dali::Ui::View MakeCard(){ return Dali::Ui::FlexLayout::New(); }\n',
            );
            const entryPath = path.join(dir, 'screen.preview.dali.cpp');
            const body = 'FlexLayout root = FlexLayout::New();\nroot.AddChildren({ MakeCard() });\nreturn root;\n';
            const full = `#include "card.h"\n${body}`;
            const slice = buildSlice(full, entryPath, body, resolveProjectIncludes(entryPath, full));
            expect(slice.rung).to.equal('heuristic');
            expect(slice.globals).to.contain('MakeCard');
            expect(slice.sourcePaths.map((p) => path.basename(p))).to.include('card.h');
        });

        it('passes a self-contained body through unchanged (single-fn rung, no globals)', () => {
            const body = 'FlexLayout root = FlexLayout::New();\nreturn root;\n';
            const slice = buildSlice(body, path.join(dir, 'x.preview.dali.cpp'), body, []);
            expect(slice.rung).to.equal('single-fn');
            expect(slice.globals).to.equal('');
        });
    });

    describe('findProjectRoot', () => {
        it('walks up to the nearest package.json/.git marker', () => {
            const sub = path.join(dir, 'a', 'b');
            fs.mkdirSync(sub, { recursive: true });
            expect(findProjectRoot(sub)).to.equal(dir);
        });
    });
});
