/*
 * codeTransform.test.ts — emoji sanitize + vector→.Children, shared with the VS
 * Code extension. The CLI renders in the same docker image (DejaVu-only fonts,
 * View::Children initializer_list only), so these transforms must run before
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
    it('rewrites .Children(vector) into an .Add loop', () => {
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
