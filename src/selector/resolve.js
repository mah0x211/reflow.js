/**
 * @file Selector resolution against a compiled template.
 *
 * Given a parsed selector and a compiled template, produce the ordered list
 * of candidate elements together with any positional predicates that must be
 * confirmed at render time.
 *
 * Strategy — right-to-left (browser-style):
 *
 *   1. Pick a seed set from the rightmost compound using whichever of the
 *      index's four axes yields the tightest bucket (#id first, then class,
 *      then tag, then attribute-name). If none apply — the compound uses only
 *      the universal selector or only positional pseudo-classes — fall back
 *      to the byTag union.
 *   2. For every seed candidate, verify the entire compound (static
 *      portion) matches, then walk the ancestor chain to check each
 *      preceding combinator + compound. Descendant (` `) permits any depth;
 *      child (`>`) requires exactly one hop up.
 *   3. Any positional pseudo-classes present in the compounds are attached
 *      to surviving candidates as runtime predicates; the interpreter
 *      evaluates them once the actual sibling counts are known.
 *
 * Union across a selector list is deduplicated by element identity and
 * returned in document order (via the `order` field assigned by
 * buildTemplateIndex).
 */

import { sortByDocumentOrder } from './index.js';
import { matchCompound } from './match.js';

/**
 * @typedef {import('./parse.js').Compound} Compound
 * @typedef {import('./parse.js').Complex} Complex
 * @typedef {import('./parse.js').CompiledSelector} CompiledSelector
 * @typedef {import('./parse.js').PseudoCond} PseudoCond
 *
 * @typedef {{
 *   element: object,
 *   positional: PseudoCond[],
 * }} SelectorCandidate
 */

/**
 * Resolve a compiled selector against a compiled template.
 *
 * @param {import('./index.js').TemplateIndex} index
 * @param {CompiledSelector} selector
 * @returns {SelectorCandidate[]}   Candidates in document order.
 */
export function resolveSelector(index, selector) {
    /** @type {Map<object, PseudoCond[]>} */
    const merged = new Map();

    for (const complex of selector.selectors) {
        const seeds = seedForComplex(index, complex);
        for (const el of seeds) {
            if (!matchesComplex(el, complex)) continue;
            const positional = collectPositional(complex, el);
            const existing = merged.get(el);
            // If the same element matches multiple selectors in the list, the
            // stricter (positional) predicates are OR'd — but since we cannot
            // express OR at match time and the single-fragment contract will
            // reject multi-match anyway, we simply keep the first-seen set.
            if (!existing) merged.set(el, positional);
        }
    }

    const elements = sortByDocumentOrder([...merged.keys()]);
    /* c8 ignore next 2 */
    return elements.map(el => ({ element: el, positional: merged.get(el) ?? [] }));
}

/**
 * Return the seed candidate list for the rightmost compound of `complex`.
 * The narrowest available bucket is chosen; if the compound has no
 * static-anchor selector at all (bare `*` or bare pseudo-class), we fall
 * back to the union of all tagged elements.
 *
 * @param {import('./index.js').TemplateIndex} index
 * @param {Complex} complex
 * @returns {object[]}
 */
function seedForComplex(index, complex) {
    const last = complex.parts[complex.parts.length - 1].compound;

    if (last.id !== null) {
        return index.byId.get(last.id) ?? [];
    }
    if (last.classes.length > 0) {
        // Pick the class with the smallest bucket to minimize downstream work.
        let best = null;
        for (const cls of last.classes) {
            const bucket = index.byClass.get(cls);
            if (!bucket) return [];
            if (!best || bucket.length < best.length) best = bucket;
        }
        /* c8 ignore next */
        return best ?? [];
    }
    if (last.tag !== null) {
        return index.byTag.get(last.tag) ?? [];
    }
    if (last.attrs.length > 0) {
        let best = null;
        for (const a of last.attrs) {
            const bucket = index.byAttrName.get(a.name);
            if (!bucket) return [];
            if (!best || bucket.length < best.length) best = bucket;
        }
        /* c8 ignore next */
        return best ?? [];
    }
    // Bare universal or bare positional pseudo — fall back to all elements.
    const all = [];
    for (const bucket of index.byTag.values()) {
        for (const el of bucket) all.push(el);
    }
    return all;
}

/**
 * Verify that `el` matches the rightmost compound and walk the ancestor chain
 * for preceding combinators.
 *
 * @param {object} el
 * @param {Complex} complex
 * @returns {boolean}
 */
function matchesComplex(el, complex) {
    const parts = complex.parts;
    if (!matchCompound(el, parts[parts.length - 1].compound)) return false;
    if (parts.length === 1) return true;

    let cur = el.parent;
    // Walk parts right-to-left from the second-to-last down to the first.
    for (let pi = parts.length - 2; pi >= 0; pi--) {
        const combinator = parts[pi + 1].combinator;  // combinator info sits on the RIGHT side
        const compound = parts[pi].compound;
        if (combinator === '>') {
            if (!cur || !matchCompound(cur, compound)) return false;
            cur = cur.parent;
            continue;
        }
        // Descendant combinator: any ancestor is a valid match.
        let found = null;
        while (cur) {
            if (matchCompound(cur, compound)) {
                found = cur;
                break;
            }
            cur = cur.parent;
        }
        if (!found) return false;
        cur = found.parent;
    }

    return true;
}

/**
 * Gather every positional pseudo-class that must be confirmed at render time
 * for `el` to be considered a match. All pseudos live on the rightmost
 * compound — earlier compounds only qualify ancestors and their positional
 * pseudos would need to be evaluated against ancestor emissions; that use
 * case is out of scope for fragment fetching. Positional pseudos on ancestor
 * compounds are Fail-fast here so authors do not silently get the wrong
 * fragment.
 *
 * @param {Complex} complex
 * @param {object} _el
 * @returns {PseudoCond[]}
 */
function collectPositional(complex, _el) {
    const last = complex.parts[complex.parts.length - 1];
    // Reject positional pseudos on non-terminal compounds.
    for (let i = 0; i < complex.parts.length - 1; i++) {
        if (complex.parts[i].compound.pseudos.length > 0) {
            const p = complex.parts[i].compound.pseudos[0];
            const err = new Error(
                `positional pseudo-class ":${p.name}" is only supported on the rightmost compound selector`
            );
            /** @type {any} */(err).reason = 'unsupported';
            /** @type {any} */(err).feature = `pseudo-ancestor:${p.name}`;
            throw err;
        }
    }
    return last.compound.pseudos.slice();
}

/**
 * Evaluate a positional pseudo condition against a runtime emission position.
 *
 * @param {PseudoCond} cond
 * @param {{ index: number, total: number, ofTypeIndex: number, ofTypeTotal: number }} pos
 * @returns {boolean}
 */
export function evalPositional(cond, pos) {
    switch (cond.name) {
        case 'first-child': return pos.index === 1;
        case 'last-child': return pos.index === pos.total;
        case 'only-child': return pos.total === 1;
        case 'first-of-type': return pos.ofTypeIndex === 1;
        case 'last-of-type': return pos.ofTypeIndex === pos.ofTypeTotal;
        case 'only-of-type': return pos.ofTypeTotal === 1;
        case 'nth-child': return pos.index === cond.n;
        case 'nth-last-child': return pos.index === pos.total - /** @type {number} */(cond.n) + 1;
        case 'nth-of-type': return pos.ofTypeIndex === cond.n;
        case 'nth-last-of-type': return pos.ofTypeIndex === pos.ofTypeTotal - /** @type {number} */(cond.n) + 1;
        /* c8 ignore next 2 */
        default: return false;
    }
}
