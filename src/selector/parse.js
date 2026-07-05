/**
 * @file CSS selector parser for fragment extraction.
 *
 * Produces a `CompiledSelector` — a frozen AST that resolve.js consumes to
 * pick a single IR element out of a compiled template. Only the subset that
 * makes sense for server-side fragment fetching is accepted; everything else
 * is Fail-fast so callers see the rejection at parse time rather than at
 * render time.
 *
 * Accepted grammar (roughly CSS Level 3):
 *
 *     SelectorList  := Complex ( ',' Complex )*
 *     Complex       := Compound ( Combinator Compound )*
 *     Combinator    := ' '  |  '>'
 *     Compound      := ( Tag | '*' )? ( '#' Ident | '.' Ident | '[' Attr ']' | Pseudo )*
 *                      # at least one simple selector required
 *     Attr          := Ident ( ( '=' | '~=' | '|=' | '^=' | '$=' | '*=' ) ( Ident | String ) )?
 *     Pseudo        := ':' Ident ( '(' Integer ')' )?
 *
 * Supported pseudo-classes (all tree-structural, integer arg only):
 *   :first-child, :last-child, :nth-child(n), :nth-last-child(n),
 *   :only-child, :first-of-type, :last-of-type, :nth-of-type(n),
 *   :nth-last-of-type(n), :only-of-type
 *
 * Explicitly rejected (all with reason 'unsupported'):
 *   sibling combinators (+ ~), column combinator (||), pseudo-elements (::),
 *   :not / :is / :where / :has, positional formulas (An+B, odd, even),
 *   attribute namespaces (a|b), any other pseudo-class.
 */

import { ReflowSelectorError } from '../errors.js';

/**
 * @typedef {'first-child'|'last-child'|'only-child'|'first-of-type'|'last-of-type'|'only-of-type'|'nth-child'|'nth-last-child'|'nth-of-type'|'nth-last-of-type'} PseudoName
 *
 * @typedef {{ name: PseudoName, n: number | null }} PseudoCond
 * @typedef {{
 *   name: string,
 *   op: null | '=' | '~=' | '|=' | '^=' | '$=' | '*=',
 *   value: string | null,
 * }} AttrCond
 * @typedef {{
 *   type: 'compound',
 *   tag: string | null,
 *   id: string | null,
 *   classes: string[],
 *   attrs: AttrCond[],
 *   pseudos: PseudoCond[],
 * }} Compound
 * @typedef {{
 *   type: 'complex',
 *   parts: Array<{ combinator: null | ' ' | '>', compound: Compound }>,
 * }} Complex
 * @typedef {{
 *   type: 'list',
 *   source: string,
 *   selectors: Complex[],
 *   hasPositional: boolean,
 * }} CompiledSelector
 */

const POSITIONAL_PSEUDOS = new Set([
    'first-child',
    'last-child',
    'only-child',
    'first-of-type',
    'last-of-type',
    'only-of-type',
    'nth-child',
    'nth-last-child',
    'nth-of-type',
    'nth-last-of-type',
]);

const NTH_PSEUDOS = new Set([
    'nth-child',
    'nth-last-child',
    'nth-of-type',
    'nth-last-of-type',
]);

/**
 * Parse a CSS selector source into a `CompiledSelector`. Throws
 * `ReflowSelectorError` for any syntax or unsupported-construct failure.
 * The returned object is frozen and safe to share across renders.
 *
 * @param {string} source
 * @returns {CompiledSelector}
 */
export function parseSelector(source) {
    if (typeof source !== 'string') {
        throw makeSyntaxError('selector source must be a string', source, 0);
    }
    if (source.trim() === '') {
        throw makeSyntaxError('empty selector', source, 0);
    }

    const p = new Parser(source);
    const selectors = [p.parseComplex()];
    while (p.peek() === ',') {
        p.next();
        p.skipWs();
        selectors.push(p.parseComplex());
    }
    p.skipWs();
    if (!p.eof()) {
        throw makeSyntaxError(`unexpected "${p.peek()}"`, source, p.pos);
    }

    const hasPositional = selectors.some(complex =>
        complex.parts.some(part => part.compound.pseudos.length > 0)
    );

    const compiled = deepFreeze(/** @type {CompiledSelector} */({
        type: 'list',
        source,
        selectors,
        hasPositional,
    }));
    return compiled;
}

/**
 * Report whether the given value is already a compiled selector produced by
 * this module — callers use this to decide between `parseSelector` on a raw
 * string and reusing an existing AST.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCompiledSelector(value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        /** @type {any} */(value).type === 'list' &&
        Array.isArray(/** @type {any} */(value).selectors)
    );
}

class Parser {
    /** @param {string} source */
    constructor(source) {
        this.source = source;
        this.pos = 0;
    }

    eof() { return this.pos >= this.source.length; }
    peek() { return this.source[this.pos]; }
    next() { return this.source[this.pos++]; }

    skipWs() {
        while (!this.eof() && isWs(this.source[this.pos])) this.pos++;
    }

    /** @returns {Complex} */
    parseComplex() {
        this.skipWs();
        const parts = [{ combinator: null, compound: this.parseCompound() }];
        while (true) {
            const hadWs = this.skipCombinatorWs();
            if (this.eof() || this.peek() === ',') break;

            let combinator;
            if (this.peek() === '>') {
                this.next();
                this.skipWs();
                combinator = '>';
            } else if (this.peek() === '+' || this.peek() === '~') {
                const c = this.peek();
                const symbol = this.pos + 1 < this.source.length && this.peek() === '~' && this.source[this.pos + 1] === '=' ? c : c;
                throw makeUnsupportedError(
                    `combinator "${symbol}" is not supported (only descendant " " and child ">" are supported)`,
                    this.source,
                    this.pos,
                    `combinator:${symbol}`
                );
            } else if (this.peek() === '|' && this.source[this.pos + 1] === '|') {
                throw makeUnsupportedError(
                    `column combinator "||" is not supported`,
                    this.source,
                    this.pos,
                    'combinator:||'
                );
            } else if (hadWs) {
                combinator = ' ';
            } else {
                break;
            }
            parts.push({ combinator, compound: this.parseCompound() });
        }
        return { type: 'complex', parts };
    }

    /** Consume whitespace, but preserve the fact that some was seen. */
    skipCombinatorWs() {
        const before = this.pos;
        this.skipWs();
        return this.pos > before;
    }

    /** @returns {Compound} */
    parseCompound() {
        /** @type {Compound} */
        const c = { type: 'compound', tag: null, id: null, classes: [], attrs: [], pseudos: [] };
        let count = 0;

        // Optional leading type or universal
        if (!this.eof() && this.peek() === '*') {
            this.next();
            c.tag = null; // universal — leave tag null
            count++;
        } else if (!this.eof() && isIdentStart(this.peek())) {
            c.tag = this.readIdent().toLowerCase();
            count++;
        }

        while (!this.eof()) {
            const ch = this.peek();
            if (ch === '#') {
                this.next();
                if (!isIdentStart(this.peek())) {
                    throw makeSyntaxError('expected identifier after "#"', this.source, this.pos);
                }
                if (c.id !== null) {
                    throw makeSyntaxError('multiple "#id" in the same compound selector', this.source, this.pos);
                }
                c.id = this.readIdent();
                count++;
                continue;
            }
            if (ch === '.') {
                this.next();
                if (!isIdentStart(this.peek())) {
                    throw makeSyntaxError('expected identifier after "."', this.source, this.pos);
                }
                c.classes.push(this.readIdent());
                count++;
                continue;
            }
            if (ch === '[') {
                c.attrs.push(this.parseAttr());
                count++;
                continue;
            }
            if (ch === ':') {
                if (this.source[this.pos + 1] === ':') {
                    throw makeUnsupportedError(
                        'pseudo-elements ("::") are not supported',
                        this.source,
                        this.pos,
                        'pseudo-element'
                    );
                }
                c.pseudos.push(this.parsePseudo());
                count++;
                continue;
            }
            break;
        }

        if (count === 0) {
            throw makeSyntaxError('expected selector', this.source, this.pos);
        }
        return c;
    }

    /** @returns {AttrCond} */
    parseAttr() {
        // opening [
        if (this.peek() !== '[') {
            /* c8 ignore next */
            throw makeSyntaxError('expected "["', this.source, this.pos);
        }
        this.next();
        this.skipWs();
        if (!isIdentStart(this.peek())) {
            throw makeSyntaxError('expected attribute name', this.source, this.pos);
        }
        const attrStart = this.pos;
        const name = this.readIdent();

        // Namespace separator "|" is only valid when followed by another ident —
        // that means the "|" wasn't the |= operator. Reject it explicitly.
        if (this.peek() === '|' && this.source[this.pos + 1] !== '=' && this.source[this.pos + 1] !== '|') {
            throw makeUnsupportedError(
                'attribute namespaces are not supported',
                this.source,
                attrStart,
                'attr-namespace'
            );
        }

        this.skipWs();

        /** @type {AttrCond} */
        const cond = { name, op: null, value: null };

        if (this.peek() !== ']') {
            // read operator (=, ~=, |=, ^=, $=, *=)
            const opStart = this.pos;
            /** @type {'=' | '~=' | '|=' | '^=' | '$=' | '*=' | null} */
            let op = null;
            const c0 = this.peek();
            if (c0 === '=') { op = '='; this.next(); }
            else if (c0 === '~' || c0 === '|' || c0 === '^' || c0 === '$' || c0 === '*') {
                if (this.source[this.pos + 1] !== '=') {
                    throw makeSyntaxError(
                        `expected "=" after "${c0}" in attribute selector`,
                        this.source,
                        this.pos + 1
                    );
                }
                op = /** @type {'~=' | '|=' | '^=' | '$=' | '*='} */(`${c0}=`);
                this.pos += 2;
            } else {
                throw makeSyntaxError(
                    `expected attribute operator or "]"`,
                    this.source,
                    this.pos
                );
            }
            cond.op = op;
            this.skipWs();
            // read value (string or ident)
            const vc = this.peek();
            if (vc === '"' || vc === "'") {
                cond.value = this.readString(vc);
            } else if (isIdentStart(vc)) {
                cond.value = this.readIdent();
            } else {
                throw makeSyntaxError(
                    `expected attribute value after "${op}"`,
                    this.source,
                    this.pos
                );
            }
            this.skipWs();
            // case-sensitivity flag (i / s) is not supported — reject if present
            if (this.peek() === 'i' || this.peek() === 'I' || this.peek() === 's' || this.peek() === 'S') {
                throw makeUnsupportedError(
                    `attribute case-sensitivity flag is not supported`,
                    this.source,
                    this.pos,
                    'attr-case-flag'
                );
            }
            // reference opStart just to silence unused warnings on defensive paths
            void opStart;
        }

        if (this.peek() !== ']') {
            throw makeSyntaxError('expected "]" to close attribute selector', this.source, this.pos);
        }
        this.next();
        return cond;
    }

    /** @returns {PseudoCond} */
    parsePseudo() {
        // consume ':'
        this.next();
        if (!isIdentStart(this.peek())) {
            throw makeSyntaxError('expected pseudo-class name after ":"', this.source, this.pos);
        }
        const nameStart = this.pos;
        const rawName = this.readIdent();
        const name = rawName.toLowerCase();

        if (!POSITIONAL_PSEUDOS.has(name)) {
            throw makeUnsupportedError(
                `pseudo-class ":${rawName}" is not supported (supported: :first-child, :last-child, :only-child, :first-of-type, :last-of-type, :only-of-type, :nth-child(n), :nth-last-child(n), :nth-of-type(n), :nth-last-of-type(n))`,
                this.source,
                nameStart - 1,
                `pseudo:${name}`
            );
        }

        const requiresArg = NTH_PSEUDOS.has(name);
        if (!requiresArg) {
            if (this.peek() === '(') {
                throw makeSyntaxError(
                    `":${name}" does not take an argument`,
                    this.source,
                    this.pos
                );
            }
            return { name: /** @type {PseudoName} */(name), n: null };
        }

        if (this.peek() !== '(') {
            throw makeSyntaxError(
                `":${name}" requires an integer argument, e.g. ":${name}(3)"`,
                this.source,
                this.pos
            );
        }
        this.next();
        this.skipWs();
        const numStart = this.pos;
        // reject formulas: any of An+B, odd, even, negative numbers, "n" alone
        // (we only accept positive integers)
        if (!isDigit(this.peek())) {
            throw makeUnsupportedError(
                `":${name}" accepts only a positive integer literal; formulas (An+B, odd, even) are not supported`,
                this.source,
                this.pos,
                `pseudo-arg:${name}`
            );
        }
        let digits = '';
        while (isDigit(this.peek())) digits += this.next();
        this.skipWs();
        // if next is anything other than ')', reject as formula/other
        if (this.peek() !== ')') {
            throw makeUnsupportedError(
                `":${name}" accepts only a positive integer literal; formulas (An+B, odd, even) are not supported`,
                this.source,
                numStart,
                `pseudo-arg:${name}`
            );
        }
        this.next();
        const n = Number(digits);
        if (!Number.isFinite(n) || n < 1) {
            throw makeSyntaxError(
                `":${name}(n)" argument must be a positive integer (>= 1)`,
                this.source,
                numStart
            );
        }
        return { name: /** @type {PseudoName} */(name), n };
    }

    /**
     * Read a CSS identifier: begins with letter/underscore/-, followed by
     * letters, digits, underscore, or hyphen. Reflow's target set (HTML
     * attribute / class / tag names) does not require Unicode escapes.
     */
    readIdent() {
        const start = this.pos;
        // Leading char
        if (!isIdentStart(this.peek())) {
            /* c8 ignore next */
            throw makeSyntaxError('expected identifier', this.source, this.pos);
        }
        this.next();
        while (!this.eof() && isIdentPart(this.peek())) this.next();
        return this.source.slice(start, this.pos);
    }

    /**
     * @param {string} quote
     * @returns {string}
     */
    readString(quote) {
        // consume opening quote
        this.next();
        let out = '';
        while (!this.eof()) {
            const ch = this.next();
            if (ch === quote) return out;
            if (ch === '\\') {
                if (this.eof()) {
                    throw makeSyntaxError('unterminated string escape', this.source, this.pos);
                }
                out += this.next();
                continue;
            }
            if (ch === '\n' || ch === '\r') {
                throw makeSyntaxError('unterminated string literal', this.source, this.pos - 1);
            }
            out += ch;
        }
        throw makeSyntaxError('unterminated string literal', this.source, this.pos);
    }
}

function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'; }
function isDigit(c) { return c >= '0' && c <= '9'; }
function isIdentStart(c) {
    return c !== undefined && (
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        c === '_' || c === '-'
    );
}
function isIdentPart(c) {
    return c !== undefined && (
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c === '_' || c === '-'
    );
}

/**
 * @param {string} message
 * @param {string} source
 * @param {number} position
 * @returns {ReflowSelectorError}
 */
function makeSyntaxError(message, source, position) {
    return new ReflowSelectorError(`selector syntax error: ${message}`, {
        reason: 'syntax',
        source,
        position,
    });
}

/**
 * @param {string} message
 * @param {string} source
 * @param {number} position
 * @param {string} feature
 * @returns {ReflowSelectorError}
 */
function makeUnsupportedError(message, source, position, feature) {
    return new ReflowSelectorError(`selector unsupported: ${message}`, {
        reason: 'unsupported',
        source,
        position,
        feature,
    });
}

/**
 * @template T
 * @param {T} v
 * @returns {T}
 */
function deepFreeze(v) {
    if (v && typeof v === 'object') {
        for (const key of Object.keys(v)) {
            const child = /** @type {any} */(v)[key];
            if (child && typeof child === 'object') deepFreeze(child);
        }
        Object.freeze(v);
    }
    return v;
}
