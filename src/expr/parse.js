/**
 * @file Expression parser for reflow.
 * Produces an AST from a source string per the project's expression language.
 * The grammar is documented on the Parser class below.
 *
 * AST node types:
 *   { type: 'literal', value }
 *   { type: 'dollar' }                                  // $
 *   { type: 'at', name }                                // @name
 *   { type: 'dot', name }                               // .name
 *   { type: 'member', object, property, optional }
 *   { type: 'unary', op: '!', arg }
 *   { type: 'binary', op, left, right }                 // comparison / logical / coalesce
 *   { type: 'ternary', test, consequent, alternate }
 *   { type: 'call', callee, args }                      // helper call, callee = identifier
 *
 * Each AST node also carries `source` (the substring it was parsed from)
 * and `offset` (starting index within the original expression string).
 * These are used for runtime error messages.
 */

/**
 * Parse an expression string into an AST.
 * @param {string} source
 * @returns {object}
 */
export function parseExpression(source) {
    const parser = new Parser(source);
    const expr = parser.parseExpr();
    parser.skipWs();
    if (!parser.eof()) {
        throw makeParseError(parser, `unexpected token`);
    }
    return expr;
}

/**
 * Recursive-descent parser. Grammar (EBNF, per the project's expression
 * language; highest precedence first):
 *
 *   expr          := ternary
 *   ternary       := coalesce ('?' expr ':' expr)?
 *   coalesce      := logical_or ('??' logical_or)*
 *   logical_or    := logical_and ('||' logical_and)*
 *   logical_and   := comparison ('&&' comparison)*
 *   comparison    := unary (comparison_op unary)?
 *   comparison_op := '==' | '!=' | '<=' | '>=' | '<' | '>'
 *   unary         := ('!')? postfix
 *   postfix       := primary ('?.' identifier | '.' identifier)*
 *   primary       := literal | scope_ref | helper_call | '(' expr ')'
 *   scope_ref     := '$' path_tail
 *                  | '@' identifier path_tail
 *                  | '.' identifier path_tail
 *   path_tail     := ('.' identifier | '?.' identifier)*
 *   helper_call   := identifier '(' arg_list? ')'
 *   arg_list      := expr (',' expr)*
 *   literal       := string_literal | number_literal | 'true' | 'false' | 'null'
 *
 * Disallowed (parse error): arithmetic, string concatenation, method calls,
 * array/object/template literals, assignment, regex, bitwise, in/instanceof,
 * typeof/void/delete. Delegate those to helpers. Banning method calls makes
 * .constructor-based prototype escapes lexically impossible.
 */
class Parser {
    /**
     * @param {string} source
     */
    constructor(source) {
        this.src = source;
        this.pos = 0;
    }

    /** @returns {boolean} */
    eof() { return this.pos >= this.src.length; }

    skipWs() {
        while (this.pos < this.src.length) {
            const ch = this.src.charCodeAt(this.pos);
            if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
                this.pos++;
            } else {
                break;
            }
        }
    }

    starts(str) {
        this.skipWs();
        return this.src.startsWith(str, this.pos);
    }

    consume(str) {
        if (this.starts(str)) {
            this.pos += str.length;
            return true;
        }
        return false;
    }

    expect(str) {
        if (!this.consume(str)) {
            throw makeParseError(this, `expected "${str}"`);
        }
    }

    // ==== Grammar ====

    parseExpr() { return this.parseTernary(); }

    parseTernary() {
        const start = this.mark();
        const cond = this.parseCoalesce();
        if (this.consume('?')) {
            const consequent = this.parseExpr();
            this.expect(':');
            const alternate = this.parseExpr();
            return this.finish({ type: 'ternary', test: cond, consequent, alternate }, start);
        }
        return cond;
    }

    parseCoalesce() {
        let left = this.parseLogicalOr();
        while (this.starts('??')) {
            const start = this.markAt(left);
            this.pos += 2;
            const right = this.parseLogicalOr();
            left = this.finish({ type: 'binary', op: '??', left, right }, start);
        }
        return left;
    }

    parseLogicalOr() {
        let left = this.parseLogicalAnd();
        while (this.starts('||')) {
            const start = this.markAt(left);
            this.pos += 2;
            const right = this.parseLogicalAnd();
            left = this.finish({ type: 'binary', op: '||', left, right }, start);
        }
        return left;
    }

    parseLogicalAnd() {
        let left = this.parseComparison();
        while (this.starts('&&')) {
            const start = this.markAt(left);
            this.pos += 2;
            const right = this.parseComparison();
            left = this.finish({ type: 'binary', op: '&&', left, right }, start);
        }
        return left;
    }

    parseComparison() {
        const start = this.mark();
        const left = this.parseUnary();
        this.skipWs();
        const opStart = this.pos;
        let op = null;
        if (this.starts('==')) { op = '=='; this.pos += 2; }
        else if (this.starts('!=')) { op = '!='; this.pos += 2; }
        else if (this.starts('<=')) { op = '<='; this.pos += 2; }
        else if (this.starts('>=')) { op = '>='; this.pos += 2; }
        else if (this.starts('<')) { op = '<'; this.pos += 1; }
        else if (this.starts('>')) { op = '>'; this.pos += 1; }
        if (op) {
            const right = this.parseUnary();
            return this.finish({ type: 'binary', op, left, right }, start);
        }
        return left;
    }

    parseUnary() {
        this.skipWs();
        if (this.starts('!')) {
            // Distinguish '!' from '!='
            if (this.src[this.pos + 1] === '=') {
                return this.parsePostfix();
            }
            const start = this.mark();
            this.pos++;
            const arg = this.parseUnary();
            return this.finish({ type: 'unary', op: '!', arg }, start);
        }
        return this.parsePostfix();
    }

    parsePostfix() {
        const start = this.mark();
        let node = this.parsePrimary();
        while (true) {
            this.skipWs();
            if (this.starts('?.')) {
                this.pos += 2;
                const name = this.readIdentifier();
                if (!name) throw makeParseError(this, `expected identifier after "?."`);
                node = this.finish({ type: 'member', object: node, property: name, optional: true }, start);
            } else if (this.starts('.')) {
                // Must be property access; look-ahead for identifier char
                const nextCh = this.src.charCodeAt(this.pos + 1);
                if (!isIdStart(nextCh)) break;
                this.pos++;
                const name = this.readIdentifier();
                node = this.finish({ type: 'member', object: node, property: name, optional: false }, start);
            } else {
                break;
            }
        }
        return node;
    }

    parsePrimary() {
        this.skipWs();
        const start = this.mark();
        if (this.eof()) throw makeParseError(this, `unexpected end of expression`);

        const ch = this.src[this.pos];

        // Parenthesized
        if (ch === '(') {
            this.pos++;
            const inner = this.parseExpr();
            this.skipWs();
            this.expect(')');
            return inner;
        }

        // String literal
        if (ch === "'" || ch === '"') {
            return this.readStringLiteral(start);
        }

        // Number literal (including negative)
        if (ch === '-' && isDigit(this.src.charCodeAt(this.pos + 1))) {
            return this.readNumberLiteral(start);
        }
        if (isDigit(this.src.charCodeAt(this.pos))) {
            return this.readNumberLiteral(start);
        }

        // Scope references
        if (ch === '$') {
            this.pos++;
            // Must be followed by '.' + identifier (chain via parsePostfix)
            if (this.src[this.pos] !== '.') {
                throw makeParseError(this, `"$" must be followed by ".<identifier>"`);
            }
            return this.finish({ type: 'dollar' }, start);
        }
        if (ch === '@') {
            this.pos++;
            const name = this.readIdentifier();
            if (!name) throw makeParseError(this, `"@" must be followed by an identifier`);
            return this.finish({ type: 'at', name }, start);
        }
        if (ch === '.') {
            // '.identifier' — bare identifier accessor
            const nextCh = this.src.charCodeAt(this.pos + 1);
            if (!isIdStart(nextCh)) {
                throw makeParseError(this, `"." must be followed by an identifier`);
            }
            this.pos++;
            const name = this.readIdentifier();
            return this.finish({ type: 'dot', name }, start);
        }

        // Identifier — literal keyword or helper call
        if (isIdStart(this.src.charCodeAt(this.pos))) {
            const name = this.readIdentifier();
            // Reserved literal keywords
            if (name === 'true') return this.finish({ type: 'literal', value: true }, start);
            if (name === 'false') return this.finish({ type: 'literal', value: false }, start);
            if (name === 'null') return this.finish({ type: 'literal', value: null }, start);
            // Must be a function call
            this.skipWs();
            if (this.src[this.pos] !== '(') {
                throw makeParseError(this, `bare identifier "${name}" is not a valid expression (helpers must be called: "${name}(...)")`);
            }
            this.pos++;
            const args = [];
            this.skipWs();
            if (this.src[this.pos] !== ')') {
                while (true) {
                    args.push(this.parseExpr());
                    this.skipWs();
                    if (this.src[this.pos] === ',') { this.pos++; continue; }
                    break;
                }
            }
            this.expect(')');
            return this.finish({ type: 'call', callee: name, args }, start);
        }

        throw makeParseError(this, `unexpected character "${ch}"`);
    }

    // ==== Literals ====

    /**
     * @param {number} start
     */
    readStringLiteral(start) {
        const quote = this.src.charCodeAt(this.pos);
        this.pos++;
        let value = '';
        while (this.pos < this.src.length) {
            const ch = this.src.charCodeAt(this.pos);
            if (ch === quote) {
                this.pos++;
                return this.finish({ type: 'literal', value }, start);
            }
            if (ch === 0x5c) { // backslash
                this.pos++;
                const esc = this.src[this.pos];
                this.pos++;
                switch (esc) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case "'": value += "'"; break;
                    case '"': value += '"'; break;
                    case '`': value += '`'; break;
                    case '0': value += '\0'; break;
                    default:
                        throw makeParseError(this, `invalid escape sequence "\\${esc}"`);
                }
                continue;
            }
            value += this.src[this.pos];
            this.pos++;
        }
        throw makeParseError(this, `unterminated string literal`);
    }

    /**
     * @param {number} start
     */
    readNumberLiteral(start) {
        const beginPos = this.pos;
        if (this.src[this.pos] === '-') this.pos++;
        while (this.pos < this.src.length && isDigit(this.src.charCodeAt(this.pos))) this.pos++;
        if (this.src[this.pos] === '.' && isDigit(this.src.charCodeAt(this.pos + 1))) {
            this.pos++;
            while (this.pos < this.src.length && isDigit(this.src.charCodeAt(this.pos))) this.pos++;
        }
        // Optional exponent
        if (this.src[this.pos] === 'e' || this.src[this.pos] === 'E') {
            this.pos++;
            if (this.src[this.pos] === '+' || this.src[this.pos] === '-') this.pos++;
            while (this.pos < this.src.length && isDigit(this.src.charCodeAt(this.pos))) this.pos++;
        }
        const text = this.src.slice(beginPos, this.pos);
        const value = Number(text);
        /* c8 ignore start */
        if (Number.isNaN(value)) {
            throw makeParseError(this, `invalid number literal "${text}"`);
        }
        /* c8 ignore stop */
        return this.finish({ type: 'literal', value }, start);
    }

    /** @returns {string} */
    readIdentifier() {
        const start = this.pos;
        if (!isIdStart(this.src.charCodeAt(this.pos))) return '';
        this.pos++;
        while (this.pos < this.src.length && isIdCont(this.src.charCodeAt(this.pos))) this.pos++;
        return this.src.slice(start, this.pos);
    }

    // ==== Position tracking ====

    mark() {
        this.skipWs();
        return this.pos;
    }

    markAt(node) {
        /* c8 ignore next */
        return node.offset ?? this.pos;
    }

    finish(node, start) {
        node.offset = start;
        node.source = this.src.slice(start, this.pos);
        return node;
    }
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isIdStart(ch) {
    return (
        (ch >= 0x41 && ch <= 0x5a) || // A-Z
        (ch >= 0x61 && ch <= 0x7a) || // a-z
        ch === 0x5f || ch === 0x24    // _ or $  (note: $ leading identifier only allowed in helper names; scope $ is a distinct token handled in parsePrimary)
    );
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isIdCont(ch) {
    return (
        isIdStart(ch) ||
        (ch >= 0x30 && ch <= 0x39)    // 0-9
    );
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isDigit(ch) {
    return ch >= 0x30 && ch <= 0x39;
}

/**
 * @param {Parser} parser
 * @param {string} message
 * @returns {Error}
 */
function makeParseError(parser, message) {
    const err = /** @type {Error & { exprOffset?: number }} */ (
        new Error(`expression parse error at position ${parser.pos}: ${message}`)
    );
    err.exprOffset = parser.pos;
    return err;
}
