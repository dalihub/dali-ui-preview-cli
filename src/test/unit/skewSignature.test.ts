import { expect } from 'chai';
import { isRuntimeApiSkew } from '../../skewSignature';

describe('isRuntimeApiSkew', () => {
    it('flags the AddChildren rename (curly quotes, as g++ emits)', () => {
        expect(isRuntimeApiSkew('‘class Dali::Ui::FlexLayout’ has no member named ‘AddChildren’; did you mean ‘Children’?')).to.equal(true);
    });
    it('flags the removed focus API', () => {
        expect(isRuntimeApiSkew("‘class Dali::Ui::UiConfig’ has no member named ‘SetAlwaysShowFocus’")).to.equal(true);
    });
    it('flags a FUTURE rename with no hardcoded name', () => {
        expect(isRuntimeApiSkew("‘class Dali::Ui::View’ has no member named ‘SomeNewApi2027’")).to.equal(true);
    });
    it('accepts ASCII quotes too', () => {
        expect(isRuntimeApiSkew("'class Dali::Ui::View' has no member named 'AddChildren'")).to.equal(true);
    });
    it('does NOT flag an unrelated compile error', () => {
        expect(isRuntimeApiSkew('error: expected ‘;’ before ‘}’ token')).to.equal(false);
    });
});
