/*
 * codeTransform.test.ts — emoji sanitize + vector→AddChildren, shared with the VS
 * Code extension. The CLI renders in the same docker image (DejaVu-only fonts,
 * View::AddChildren initializer_list only), so these transforms must run before
 * templating. No docker / rendering here — pure string transforms.
 */

import { expect } from 'chai';
import { sanitizeUnsupportedGlyphs, transformVectorChildren, applyPreviewTransforms } from '../../codeTransform';

describe('codeTransform.sanitizeUnsupportedGlyphs', () => {
    it('replaces emoji in string literals with □', () => {
        const out = sanitizeUnsupportedGlyphs('return Label::New("☀ Sunny ⛅");');
        expect(out.replaced).to.equal(true);
        expect(out.code).to.include('"□ Sunny □"');
    });

    it('keeps box-drawing / geometric / degree (they render fine)', () => {
        const src = 'return Label::New("55° ━━━ ● ▮ 70°");';
        const out = sanitizeUnsupportedGlyphs(src);
        expect(out.replaced).to.equal(false);
        expect(out.code).to.equal(src);
    });
});

describe('codeTransform.transformVectorChildren', () => {
    it('rewrites non-fluent AddChildren(vector) statement into an .Add loop', () => {
        const out = transformVectorChildren('    root.AddChildren(items);');
        expect(out).to.include('for (auto& __ce : items) { root.Add(__ce); }');
        expect(out).to.not.match(/AddChildren\(items\)/);
    });

    // dali-ui 2.5.32 REMOVED the child adder entirely — measured:
    //   'class Dali::Ui::FlexLayout' has no member named 'AddChildren'
    // so the init-list form must be rewritten too. Leaving it alone (the old
    // assumption: "an initializer_list overload survives") made every sample using
    // the brace form fail to compile against the 2.5.32 runtime.
    it('rewrites init-list AddChildren({ ... }) into per-child .Add() calls', () => {
        const out = transformVectorChildren('root.AddChildren({ title, subtitle });');
        expect(out).to.equal('root.Add(title); root.Add(subtitle);');
        expect(out).to.not.match(/AddChildren/);
    });

    it('rewrites a multi-line init-list (the sample idiom) and keeps nested calls intact', () => {
        const out = transformVectorChildren([
            'root.AddChildren({',
            '    Label::New("a, b"),',
            '    makeCard(x, y),',
            '});',
        ].join('\n'));
        expect(out).to.equal('root.Add(Label::New("a, b")); root.Add(makeCard(x, y));');
    });

    it('rewrites legacy .Children(vector) into an .Add loop', () => {
        const out = transformVectorChildren('return StackLayout::New().SetSpacing(20).Children(rows);');
        expect(out).to.include('for (auto& __ce : rows)');
        expect(out).to.include('__cw.Add(__ce)');
        expect(out).to.not.match(/\.Children\(rows\)/);
    });

    it('leaves { init-list } .Children untouched', () => {
        const src = 'return StackLayout::New().Children({ Label::New("a"), Label::New("b") });';
        expect(transformVectorChildren(src)).to.equal(src);
    });
});

describe('codeTransform.applyPreviewTransforms', () => {
    it('applies both and reports emoji replacement', () => {
        const r = applyPreviewTransforms('return Box::New().SetIcon("☀").Children(items);');
        expect(r.emojiReplaced).to.equal(true);
        expect(r.code).to.include('"□"');
        expect(r.code).to.include('for (auto& __ce : items)');
    });
});
