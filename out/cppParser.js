"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// VENDORED from paperclip (DALi Preview VS Code extension) for the dali-ui-preview
// CLI — copied for a self-contained release (ADR-007, M0/WU-2). Behavior unchanged.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * cppParser.ts — TypeScript C++ chaining code parser
 *
 * Parses dali-ui builder-pattern C++ into a JSON SceneNode tree.
 * Returns null on any unsupported pattern so the caller can fall back
 * to the compile path (~500ms).
 *
 * Supported input:
 *   return TypeName::New(args...)
 *       .Method(value)
 *       .Children({ TypeName::New(...), ... });
 *
 * Unsupported → null:
 *   Ternary operators, control flow keywords, preprocessor directives,
 *   bare user-defined function calls.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChainExpression = parseChainExpression;
exports.clearParserCache = clearParserCache;
// ---------------------------------------------------------------------------
// LRU cache (10 entries, keyed by code string)
// ---------------------------------------------------------------------------
const CACHE_SIZE = 10;
const _cache = new Map();
const _cacheOrder = [];
function _cacheGet(key) {
    if (!_cache.has(key)) {
        return undefined;
    }
    // Refresh LRU order on hit
    const idx = _cacheOrder.indexOf(key);
    if (idx !== -1) {
        _cacheOrder.splice(idx, 1);
        _cacheOrder.push(key);
    }
    return _cache.get(key);
}
function _cacheSet(key, result) {
    if (_cacheOrder.length >= CACHE_SIZE) {
        const oldest = _cacheOrder.shift();
        _cache.delete(oldest);
    }
    _cacheOrder.push(key);
    _cache.set(key, result);
}
// Keywords that indicate unparseable code → triggers compile fallback
const FAIL_KEYWORDS = new Set([
    'if', 'for', 'while', 'do', 'switch', 'else', 'goto',
    'auto', 'int', 'float', 'bool', 'char', 'double', 'void',
    'const', 'static', 'class', 'struct', 'namespace',
    'using', 'template', 'typename',
    'new', 'delete', 'throw', 'operator',
]);
/**
 * Tokenize a C++ chaining expression.
 * Returns null if any unsupported token (ternary `?`, `#`) is encountered.
 */
function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;
    while (i < src.length) {
        // Whitespace
        if (/\s/.test(src[i])) {
            if (src[i] === '\n') {
                line++;
            }
            i++;
            continue;
        }
        // Line comment
        if (src[i] === '/' && i + 1 < src.length && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') {
                i++;
            }
            continue;
        }
        // Block comment
        if (src[i] === '/' && i + 1 < src.length && src[i + 1] === '*') {
            i += 2;
            while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') {
                    line++;
                }
                i++;
            }
            i += 2;
            continue;
        }
        // Ternary / preprocessor → unsupported
        if (src[i] === '?' || src[i] === '#') {
            return null;
        }
        // Scope operator
        if (src[i] === ':' && i + 1 < src.length && src[i + 1] === ':') {
            tokens.push({ kind: 'SCOPE', text: '::', line });
            i += 2;
            continue;
        }
        // Single-char punctuation
        switch (src[i]) {
            case '.':
                tokens.push({ kind: 'DOT', text: '.', line });
                i++;
                continue;
            case ',':
                tokens.push({ kind: 'COMMA', text: ',', line });
                i++;
                continue;
            case ';':
                tokens.push({ kind: 'SEMI', text: ';', line });
                i++;
                continue;
            case '(':
                tokens.push({ kind: 'LPAREN', text: '(', line });
                i++;
                continue;
            case ')':
                tokens.push({ kind: 'RPAREN', text: ')', line });
                i++;
                continue;
            case '{':
                tokens.push({ kind: 'LBRACE', text: '{', line });
                i++;
                continue;
            case '}':
                tokens.push({ kind: 'RBRACE', text: '}', line });
                i++;
                continue;
        }
        // Negative number: '-' followed immediately by a digit
        if (src[i] === '-' && i + 1 < src.length && /\d/.test(src[i + 1])) {
            let j = i + 1;
            while (j < src.length && /[\d.]/.test(src[j])) {
                j++;
            }
            if (j < src.length && src[j] === 'f') {
                j++;
            }
            tokens.push({ kind: 'NUMBER', text: src.slice(i, j), line });
            i = j;
            continue;
        }
        // Number (positive)
        if (/\d/.test(src[i])) {
            let j = i;
            if (src[j] === '0' && j + 1 < src.length && src[j + 1] === 'x') {
                // Hex literal
                j += 2;
                while (j < src.length && /[0-9a-fA-F]/.test(src[j])) {
                    j++;
                }
            }
            else {
                while (j < src.length && /[\d.]/.test(src[j])) {
                    j++;
                }
                if (j < src.length && src[j] === 'f') {
                    j++;
                }
            }
            tokens.push({ kind: 'NUMBER', text: src.slice(i, j), line });
            i = j;
            continue;
        }
        // String literal
        if (src[i] === '"') {
            let j = i + 1;
            while (j < src.length && src[j] !== '"') {
                if (src[j] === '\\') {
                    j++;
                } // skip escape
                j++;
            }
            j++; // closing "
            tokens.push({ kind: 'STRING', text: src.slice(i, j), line });
            i = j;
            continue;
        }
        // Identifier / keyword
        if (/[a-zA-Z_]/.test(src[i])) {
            let j = i;
            while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) {
                j++;
            }
            const text = src.slice(i, j);
            if (FAIL_KEYWORDS.has(text)) {
                return null;
            }
            tokens.push({ kind: 'IDENT', text, line });
            i = j;
            continue;
        }
        // Unknown character → unsupported
        return null;
    }
    tokens.push({ kind: 'EOF', text: '', line });
    return tokens;
}
// ---------------------------------------------------------------------------
// Recursive descent parser
// ---------------------------------------------------------------------------
class CppChainParser {
    constructor(tokens, startLineOffset) {
        this.tokens = tokens;
        this.startLineOffset = startLineOffset;
        this.idx = 0;
    }
    // -----------------------------------------------------------------------
    peek() {
        return this.tokens[this.idx] ?? { kind: 'EOF', text: '' };
    }
    consume() {
        return this.tokens[this.idx++] ?? { kind: 'EOF', text: '' };
    }
    expect(kind) {
        if (this.peek().kind !== kind) {
            return null;
        }
        return this.consume();
    }
    // -----------------------------------------------------------------------
    // Top-level entry
    // -----------------------------------------------------------------------
    parse() {
        // Optional 'return' keyword
        if (this.peek().kind === 'IDENT' && this.peek().text === 'return') {
            this.consume();
        }
        const node = this.parseNode();
        if (!node) {
            return null;
        }
        // Optional semicolon
        if (this.peek().kind === 'SEMI') {
            this.consume();
        }
        // Must be at end
        if (this.peek().kind !== 'EOF') {
            return null;
        }
        return node;
    }
    // -----------------------------------------------------------------------
    // Node: TypeName::New(args).Method(args)...
    // -----------------------------------------------------------------------
    parseNode() {
        // Type name
        const typeToken = this.expect('IDENT');
        if (!typeToken) {
            return null;
        }
        // ::New
        if (!this.expect('SCOPE')) {
            return null;
        }
        const newToken = this.expect('IDENT');
        if (!newToken || newToken.text !== 'New') {
            return null;
        }
        // Constructor args
        if (!this.expect('LPAREN')) {
            return null;
        }
        const constructorArgs = this.parseArgValueList();
        if (constructorArgs === null) {
            return null;
        }
        if (!this.expect('RPAREN')) {
            return null;
        }
        // typeToken.line is 1-based within the tokenised code. Convert to
        // a 0-based line index and add startLineOffset so consumers (the
        // C++ server + click-to-code handler) see absolute 0-based source lines
        // that match instrumentCode()'s __L{line} convention.
        const sourceLine = (typeToken.line - 1) + this.startLineOffset;
        const node = {
            type: typeToken.text,
            constructorArgs,
            properties: {},
            children: [],
            sourceLine,
        };
        // Chained method calls
        while (this.peek().kind === 'DOT') {
            this.consume(); // '.'
            const methodToken = this.expect('IDENT');
            if (!methodToken) {
                return null;
            }
            const method = methodToken.text;
            if (!this.expect('LPAREN')) {
                return null;
            }
            if (method === 'Children') {
                // Children({ ... })
                if (!this.expect('LBRACE')) {
                    return null;
                }
                const children = this.parseChildrenList();
                if (children === null) {
                    return null;
                }
                if (!this.expect('RBRACE')) {
                    return null;
                }
                node.children = children;
            }
            else {
                const args = this.parseArgValueList();
                if (args === null) {
                    return null;
                }
                node.properties[method] = args;
            }
            if (!this.expect('RPAREN')) {
                return null;
            }
        }
        return node;
    }
    // -----------------------------------------------------------------------
    // Children list: node, node, ...
    // -----------------------------------------------------------------------
    parseChildrenList() {
        const children = [];
        while (this.peek().kind !== 'RBRACE') {
            if (this.peek().kind === 'EOF') {
                return null;
            }
            const child = this.parseNode();
            if (!child) {
                return null;
            }
            children.push(child);
            // Optional comma after each child
            if (this.peek().kind === 'COMMA') {
                this.consume();
            }
        }
        return children;
    }
    // -----------------------------------------------------------------------
    // Argument value list: arg, arg, ...
    // -----------------------------------------------------------------------
    parseArgValueList() {
        const args = [];
        // Empty arg list
        if (this.peek().kind === 'RPAREN' || this.peek().kind === 'RBRACE') {
            return args;
        }
        while (true) {
            const arg = this.parseArgValue();
            if (arg === null) {
                return null;
            }
            args.push(arg);
            if (this.peek().kind === 'COMMA') {
                this.consume();
                // Trailing comma before close
                if (this.peek().kind === 'RPAREN' || this.peek().kind === 'RBRACE') {
                    break;
                }
            }
            else {
                break;
            }
        }
        return args;
    }
    // -----------------------------------------------------------------------
    // Single argument value → raw string
    //
    // Handles:
    //   - Number:           200.0f, -3, 0x1e1e2e
    //   - String:           "Hello"
    //   - Constant:         MATCH_PARENT, WRAP_CONTENT
    //   - Enum:             FlexDirection::COLUMN
    //   - Constructor:      UiColor(0x...), Extents(a,b,c,d)
    // -----------------------------------------------------------------------
    parseArgValue() {
        const t = this.peek();
        if (t.kind === 'NUMBER') {
            this.consume();
            return t.text;
        }
        if (t.kind === 'STRING') {
            this.consume();
            return t.text;
        }
        if (t.kind === 'IDENT') {
            this.consume();
            let result = t.text;
            // Optional scope resolution: Enum::VALUE or Namespace::Constructor
            if (this.peek().kind === 'SCOPE') {
                this.consume();
                const next = this.expect('IDENT');
                if (!next) {
                    return null;
                }
                result += '::' + next.text;
            }
            // Optional call parens: UiColor(0x...), Extents(a,b,c,d)
            if (this.peek().kind === 'LPAREN') {
                this.consume();
                const innerArgs = this.parseArgValueList();
                if (innerArgs === null) {
                    return null;
                }
                if (!this.expect('RPAREN')) {
                    return null;
                }
                result += '(' + innerArgs.join(', ') + ')';
            }
            return result;
        }
        return null;
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Parse a dali-ui C++ chaining expression into a SceneNode tree.
 *
 * @param code        The extracted preview code (may include leading `return`).
 * @param startLine   Absolute 0-based line index in the original source file
 *                    where `code` begins. Propagated into each SceneNode's
 *                    `sourceLine` so the C++ server can tag actors with
 *                    `__L{line}` for click-to-code. Defaults to 0.
 * @returns           SceneNode on success, null if unsupported pattern detected.
 */
function parseChainExpression(code, startLine = 0) {
    const cacheKey = `${startLine}:${code}`;
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) {
        return cached;
    }
    const tokens = tokenize(code);
    if (!tokens) {
        _cacheSet(cacheKey, null);
        return null;
    }
    const result = new CppChainParser(tokens, startLine).parse();
    _cacheSet(cacheKey, result);
    return result;
}
/** Clear the parse result cache (useful in tests). */
function clearParserCache() {
    _cache.clear();
    _cacheOrder.length = 0;
}
