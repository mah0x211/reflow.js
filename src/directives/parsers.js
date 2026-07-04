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
 *   S  Structural x-if / x-elseif / x-else / x-match / x-case / x-nocase
 *   I  Iteration  x-for / x-each
 *   C  Content    x-text / x-html / x-include
 *   A  Attribute  x-bind:* (multiple allowed when attribute names differ)
 *   K  Control    x-break / x-break-if
 *
 * Same-element rules: within a group, at most one directive (except A, which
 * allows several distinct attribute names). Across groups, S/I/K are mutually
 * exclusive with each other; every other cross-group pair is allowed.
 *
 * @type {Record<string, 'D' | 'S' | 'I' | 'C' | 'A' | 'K'>}
 */
export const DIRECTIVE_GROUP = {
    data: 'D',
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
