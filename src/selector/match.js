/**
 * @file Compound-selector matching primitive.
 *
 * `matchCompound` decides whether a single element node satisfies the static
 * (non-positional) portion of one CSS compound selector. Positional
 * pseudo-classes (`:first-child`, `:nth-child`, ...) are intentionally
 * excluded here — they depend on runtime emission order and are evaluated
 * later by the interpreter using position counters.
 */

import { getStaticAttr, getStaticClassSet } from './index.js';

/**
 * Return true when `el` matches every non-positional condition of `compound`.
 *
 * @param {object} el                     Element IR node.
 * @param {import('./parse.js').Compound} compound
 * @returns {boolean}
 */
export function matchCompound(el, compound) {
    if (compound.tag !== null && el.tagName !== compound.tag) return false;

    if (compound.id !== null && getStaticAttr(el, 'id') !== compound.id) return false;

    if (compound.classes.length > 0) {
        const classes = getStaticClassSet(el);
        for (const cls of compound.classes) {
            if (!classes.has(cls)) return false;
        }
    }

    for (const attrCond of compound.attrs) {
        const value = getStaticAttr(el, attrCond.name);
        if (!matchAttr(value, attrCond)) return false;
    }

    return true;
}

/**
 * Return true when `value` (the element's static attribute value, or null if
 * absent) satisfies the attribute condition.
 *
 * @param {string | null} value
 * @param {import('./parse.js').AttrCond} cond
 * @returns {boolean}
 */
function matchAttr(value, cond) {
    if (cond.op === null) return value !== null;
    if (value === null) return false;
    const target = /** @type {string} */(cond.value);
    switch (cond.op) {
        case '=': return value === target;
        case '~=': {
            if (target === '' || /\s/.test(target)) return false;
            const tokens = value.split(/\s+/).filter(t => t !== '');
            return tokens.includes(target);
        }
        case '|=': return value === target || value.startsWith(target + '-');
        case '^=': return target !== '' && value.startsWith(target);
        case '$=': return target !== '' && value.endsWith(target);
        case '*=': return target !== '' && value.includes(target);
        /* c8 ignore next 2 */
        default: return false;
    }
}
