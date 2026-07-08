"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNTIME_API_SKEW_RE = void 0;
exports.isRuntimeApiSkew = isRuntimeApiSkew;
// ─────────────────────────────────────────────────────────────────────────────
// VENDORED from paperclip src/skewSignature.ts (ADR-007) — the CLI must not import
// across repos. Keep byte-identical to the parent's regex; the shared-library
// consolidation is M3.
// ─────────────────────────────────────────────────────────────────────────────
// Shared dali-ui runtime-API-skew signature. When a dali-ui release renames or
// removes a member, g++ emits: `'class Dali::Ui::X' has no member named 'Y'`.
// g++ uses Unicode curly quotes (U+2018/U+2019), NOT ASCII — the char class must
// accept both. Matches ANY missing member on ANY qualified `Dali::` type
// (Dali::Actor / Dali::Window / Dali::Ui::UiConfig, …) — future-proof and covers
// dali-core/adaptor skew, not just Dali::Ui::.
exports.RUNTIME_API_SKEW_RE = /Dali(::\w+)+['‘’]?\s+has no member named\s+['‘’]?\w+/;
function isRuntimeApiSkew(stderr) {
    return exports.RUNTIME_API_SKEW_RE.test(String(stderr ?? ''));
}
