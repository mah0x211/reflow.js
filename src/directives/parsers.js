/**
 * @file Directive value parsers.
 *
 * Each function takes a raw attribute value and returns parsed metadata for
 * the IR. Parsers throw plain Error instances; the compile pipeline wraps them
 * into ReflowCompileError with source info. Per-directive value grammar and
 * Fail-fast conditions are documented on each parser; directive grouping for
 * combination validation is on DIRECTIVE_GROUP.
 */

import JSON5 from 'json5';
import { parseExpression } from '../expr/parse.js';

/**
 * Parse an x-data attribute value.
 *
 * Grammar (per the directive spec): one or more `name: <JSON5-object>` pairs
 * separated by commas. The value is wrapped in `{}` and parsed as JSON5, so
 * JSON5 sugar (unquoted keys, single quotes, trailing commas, comments) is
 * allowed and multiple top-level keys become independent named scopes. The
 * result must be an object (array / primitive / parse failure is Fail-fast).
 *
 * @param {string} value
 * @returns {{ scopes: Record<string, unknown> }}
 */
export function parseData(value) {
    let parsed;
    try {
        parsed = JSON5.parse('{' + value + '}');
    } catch (e) {
        throw new Error(`x-data: invalid JSON5: ${e.message}`);
    }
    // x-data value must resolve to an object. `{}`-wrapping guarantees this
    // for well-formed JSON5, so the check below is defensive against future
    // changes to the wrapping strategy.
    /* c8 ignore start */
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`x-data: value must parse to an object`);
    }
    /* c8 ignore stop */
    return { scopes: parsed };
}

/**
 * Parse an x-with attribute value.
 *
 * Grammar (per the directive spec):
 *   x-with = binding ("," binding)*
 *   binding = ident "=" expression
 *
 * Each `expression` is anything the shared expression language accepts —
 * primitive literals, scope references (`$`, `@name`, `.name` with member
 * chain), helper calls, object literals, and array literals. Bindings are
 * separated by top-level `,`; commas inside object / array literals, helper
 * argument lists, and string literals are handled by depth-tracking the raw
 * value here so that a single expression parse call gets the full slice.
 *
 * Fail-fast on: missing `=`, missing/empty binding name, empty value, an
 * expression that fails to parse, or a duplicate binding name in the same
 * directive.
 *
 * @param {string} value
 * @returns {{ bindings: Array<{ name: string, expr: object }> }}
 */
export function parseWith(value) {
    const src = value ?? '';
    const bindings = [];
    const seen = new Set();
    let pos = 0;

    const skipWs = () => {
        while (pos < src.length) {
            const ch = src.charCodeAt(pos);
            if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
                pos++;
            } else {
                break;
            }
        }
    };

    while (true) {
        skipWs();
        if (pos >= src.length) break;

        // Binding name
        const nameStart = pos;
        if (!isIdStartCh(src.charCodeAt(pos))) {
            throw new Error(`x-with: expected binding name at position ${pos}`);
        }
        pos++;
        while (pos < src.length && isIdContCh(src.charCodeAt(pos))) pos++;
        const name = src.slice(nameStart, pos);

        if (seen.has(name)) {
            throw new Error(`x-with: duplicate binding name "${name}"`);
        }

        skipWs();
        if (src[pos] !== '=') {
            throw new Error(`x-with: expected "=" after binding name "${name}"`);
        }
        pos++; // consume '='

        // Scan the expression slice: consume up to the next top-level `,` or
        // end-of-input, tracking bracket depth and string literals so that
        // commas inside object/array/call/string do not terminate the value.
        skipWs();
        const exprStart = pos;
        let depth = 0;
        while (pos < src.length) {
            const ch = src[pos];
            if (ch === '"' || ch === "'") {
                pos = skipStringLiteral(src, pos, name);
                continue;
            }
            if (ch === '{' || ch === '[' || ch === '(') { depth++; pos++; continue; }
            if (ch === '}' || ch === ']' || ch === ')') {
                if (depth === 0) {
                    throw new Error(`x-with: unbalanced "${ch}" in binding "${name}"`);
                }
                depth--; pos++; continue;
            }
            if (ch === ',' && depth === 0) break;
            pos++;
        }
        if (depth !== 0) {
            throw new Error(`x-with: unbalanced brackets in binding "${name}"`);
        }
        const exprSrc = src.slice(exprStart, pos).trim();
        if (!exprSrc) {
            throw new Error(`x-with: value expression is required for binding "${name}"`);
        }
        let expr;
        try {
            expr = parseExpression(exprSrc);
        } catch (e) {
            throw new Error(`x-with: ${e.message} (in binding "${name}")`);
        }

        bindings.push({ name, expr });
        seen.add(name);

        skipWs();
        if (pos >= src.length) break;
        /* c8 ignore start */
        // Defensive: the value scanner above stops only at a top-level ','
        // (consumed below) or end-of-input. Reaching this arm would mean the
        // scanner left off at some other character, which the current grammar
        // does not permit.
        if (src[pos] !== ',') {
            throw new Error(`x-with: unexpected token "${src[pos]}" at position ${pos}`);
        }
        /* c8 ignore stop */
        pos++; // consume ','
    }

    if (bindings.length === 0) {
        throw new Error(`x-with: at least one binding is required`);
    }

    return { bindings };
}

/**
 * Skip a string literal starting at `pos` (which must point to the opening
 * quote). Returns the position just past the closing quote. Handles backslash
 * escapes so that an escaped quote does not terminate the string.
 * @param {string} src
 * @param {number} pos
 * @param {string} bindingName  For error context.
 * @returns {number}
 */
function skipStringLiteral(src, pos, bindingName) {
    const quote = src[pos];
    pos++;
    while (pos < src.length) {
        const ch = src[pos];
        if (ch === '\\' && pos + 1 < src.length) { pos += 2; continue; }
        if (ch === quote) return pos + 1;
        pos++;
    }
    throw new Error(`x-with: unterminated string literal in binding "${bindingName}"`);
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isIdStartCh(ch) {
    return (
        (ch >= 0x41 && ch <= 0x5a) ||
        (ch >= 0x61 && ch <= 0x7a) ||
        ch === 0x5f || ch === 0x24
    );
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isIdContCh(ch) {
    return isIdStartCh(ch) || (ch >= 0x30 && ch <= 0x39);
}

/**
 * Parse an expression-valued directive: x-if, x-elseif, x-text, x-html,
 * x-include, x-bind:*, x-match, x-case, x-break-if. An empty value is
 * Fail-fast.
 *
 * @param {string} value
 * @param {string} directive  Directive name for error messages
 * @returns {object}          Expression AST
 */
export function parseExprValue(value, directive) {
    if (value == null || value.trim() === '') {
        throw new Error(`${directive}: value is required`);
    }
    try {
        return parseExpression(value);
    } catch (e) {
        throw new Error(`${directive}: ${e.message}`);
    }
}

/**
 * Validate that a marker directive (x-else, x-nocase, x-break) has an EMPTY
 * value. A non-empty value is Fail-fast (only the bare attribute or an empty
 * string is allowed).
 *
 * @param {string} value
 * @param {string} directive
 */
export function assertEmptyValue(value, directive) {
    if (value != null && value.trim() !== '') {
        throw new Error(`${directive}: must not have a value; got "${directive}=\"${value}\""`);
    }
}

/**
 * Parse an x-for value: `<var> = <start>, <stop>[, <step>]`.
 *
 * The range is inclusive and integers only. step defaults to 1; a negative
 * step is allowed (descending). Fail-fast on: missing '=', missing
 * start/stop, non-integer start/stop/step, step == 0, or direction mismatch
 * (start < stop with step < 0, or start > stop with step > 0).
 *
 * @param {string} value
 * @returns {{ varName: string, start: number, stop: number, step: number }}
 */
export function parseFor(value) {
    const eqIdx = value.indexOf('=');
    if (eqIdx === -1) throw new Error(`x-for: missing "=", expected "<var> = <start>, <stop>[, <step>]"`);

    const varName = value.slice(0, eqIdx).trim();
    if (!/^[a-zA-Z_$][\w$]*$/.test(varName)) {
        throw new Error(`x-for: invalid variable name "${varName}"`);
    }

    const rest = value.slice(eqIdx + 1);
    const parts = rest.split(',').map((s) => s.trim());
    if (parts.length < 2 || parts.length > 3) {
        throw new Error(`x-for: expected 2 or 3 arguments after "=", got ${parts.length}`);
    }

    const nums = parts.map((p) => parseIntStrict(p, 'x-for'));
    const [start, stop] = nums;
    const step = nums.length === 3 ? nums[2] : 1;

    if (step === 0) throw new Error(`x-for: step must not be zero`);
    if (start < stop && step < 0) {
        throw new Error(`x-for: direction mismatch (start=${start} < stop=${stop} but step=${step} < 0)`);
    }
    if (start > stop && step > 0) {
        throw new Error(`x-for: direction mismatch (start=${start} > stop=${stop} but step=${step} > 0)`);
    }

    return { varName, start, stop, step };
}

/**
 * @param {string} s
 * @param {string} directive
 * @returns {number}
 */
function parseIntStrict(s, directive) {
    if (!/^-?\d+$/.test(s)) {
        throw new Error(`${directive}: "${s}" is not an integer`);
    }
    return Number(s);
}

/**
 * Parse an x-each value: `<item>[, <index>] in <collection-expr>`.
 *
 * The `in` keyword is required; item and index names must differ. The
 * collection is an expression evaluated at render time and must be an array
 * (object iteration is unsupported; a non-array is Fail-fast at render time).
 *
 * @param {string} value
 * @returns {{ itemName: string, indexName: string | null, collection: object }}
 */
export function parseEach(value) {
    // Split at the first " in " with word boundary tolerance
    const m = value.match(/^\s*([a-zA-Z_$][\w$]*)(?:\s*,\s*([a-zA-Z_$][\w$]*))?\s+in\s+(.+)$/s);
    if (!m) {
        throw new Error(`x-each: expected "<item>[, <index>] in <collection>", got "${value}"`);
    }
    const itemName = m[1];
    const indexName = m[2] ?? null;
    const collectionSrc = m[3];
    if (!collectionSrc.trim()) {
        throw new Error(`x-each: collection expression is required`);
    }
    if (indexName && indexName === itemName) {
        throw new Error(`x-each: item name and index name must differ`);
    }
    let collection;
    try {
        collection = parseExpression(collectionSrc);
    } catch (e) {
        throw new Error(`x-each: ${e.message}`);
    }
    return { itemName, indexName, collection };
}

/**
 * The set of known directive base names. The compiler uses this to
 * detect unknown x-* attributes and Fail-fast.
 *
 * Note: x-bind is handled specially because it has a `:<name>` suffix.
 */
export const KNOWN_DIRECTIVES = new Set([
    'data',
    'with',
    'if',
    'elseif',
    'else',
    'match',
    'case',
    'nocase',
    'for',
    'each',
    'text',
    'html',
    'include',
    'bind',       // x-bind:* handled by prefix check
    'break',
    'break-if',
]);

/**
 * Classify each directive by its group, used for same-element combination
 * validation. Groups (per the project's general rules):
 *   D  Data       x-data                       (orthogonal to all others)
 *   W  With       x-with                       (orthogonal to all others; may combine with D on the same element)
 *   S  Structural x-if / x-elseif / x-else / x-match / x-case / x-nocase
 *   I  Iteration  x-for / x-each
 *   C  Content    x-text / x-html / x-include
 *   A  Attribute  x-bind:* (multiple allowed when attribute names differ)
 *   K  Control    x-break / x-break-if
 *
 * Same-element rules: within a group, at most one directive (except A, which
 * allows several distinct attribute names). Across groups, S/I/K are mutually
 * exclusive with each other; every other cross-group pair is allowed. D and W
 * may combine on the same element, but binding-name collisions between them
 * are Fail-fast at compile time.
 *
 * @type {Record<string, 'D' | 'W' | 'S' | 'I' | 'C' | 'A' | 'K'>}
 */
export const DIRECTIVE_GROUP = {
    data: 'D',
    with: 'W',
    if: 'S',
    elseif: 'S',
    else: 'S',
    match: 'S',
    case: 'S',
    nocase: 'S',
    for: 'I',
    each: 'I',
    text: 'C',
    html: 'C',
    include: 'C',
    bind: 'A',
    break: 'K',
    'break-if': 'K',
};
