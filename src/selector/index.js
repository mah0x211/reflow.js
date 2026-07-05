/**
 * @file Compile-time selector index construction.
 *
 * Walks a compiled template's IR once and:
 *   1. Annotates every element node with structural back-pointers
 *      (parent, depth, chainBranch, matchBranch, order).
 *   2. Builds indexes for the four "seed" axes that CSS selectors can start
 *      from — id, class, tag, and attribute-name — so resolve.js can pick a
 *      small candidate set without scanning the whole tree.
 *   3. Collects the x-include-bearing elements so cross-template selector
 *      resolution can enumerate them without a second walk.
 *
 * The tree is traversed with two rules that keep sibling structure honest:
 *
 *   - Chain wrappers (`x-if / x-elseif / x-else`) are transparent: their
 *     branches are annotated with the ENCLOSING element as their parent and
 *     at the SAME depth as the chain wrapper. Each branch records
 *     `chainBranch = { chain, branchIndex }` so the resolver knows the branch
 *     must be selected at render time.
 *
 *   - `x-match` cases are transparent in the same sense: their `.parent` is
 *     the `x-match` element itself (as if x-case/x-nocase were direct
 *     children in the source), and each branch records
 *     `matchBranch = { branchIndex }`.
 *
 * With these conventions, walking `.parent` chains agrees with the visual
 * structure of the template source, and the selector's descendant / child
 * combinators can be evaluated correctly without special-casing chains or
 * matches at match time.
 */

/**
 * @typedef {Map<string, object[]>} ElementBucket
 * @typedef {{
 *   byId: ElementBucket,
 *   byClass: ElementBucket,
 *   byTag: ElementBucket,
 *   byAttrName: ElementBucket,
 *   includes: object[],
 * }} TemplateIndex
 */

/**
 * Build the selector index for a compiled root IR node, annotating each
 * element with structural back-pointers as a side effect.
 *
 * @param {object} root
 * @returns {TemplateIndex}
 */
export function buildTemplateIndex(root) {
    /** @type {TemplateIndex} */
    const index = {
        byId: new Map(),
        byClass: new Map(),
        byTag: new Map(),
        byAttrName: new Map(),
        includes: [],
    };
    const state = { order: 0 };
    walkChildren(root.children, /*parent=*/null, /*depth=*/0, index, state);
    return index;
}

/**
 * @param {object[]} children
 * @param {object | null} parent
 * @param {number} depth
 * @param {TemplateIndex} index
 * @param {{ order: number }} state
 */
function walkChildren(children, parent, depth, index, state) {
    for (const child of children) {
        if (child.type === 'element') {
            annotateElement(child, parent, depth, null, null, index, state);
            walkElement(child, depth, index, state);
            continue;
        }
        if (child.type === 'chain') {
            for (let bi = 0; bi < child.branches.length; bi++) {
                const el = child.branches[bi].node;
                annotateElement(el, parent, depth, { chain: child, branchIndex: bi }, null, index, state);
                walkElement(el, depth, index, state);
            }
            continue;
        }
        // text / comment / unknown — nothing to index
    }
}

/**
 * @param {object} el
 * @param {number} depth
 * @param {TemplateIndex} index
 * @param {{ order: number }} state
 */
function walkElement(el, depth, index, state) {
    if (el.directives && el.directives.match) {
        for (let bi = 0; bi < el.directives.match.branches.length; bi++) {
            const caseEl = el.directives.match.branches[bi].node;
            annotateElement(caseEl, el, depth + 1, null, { branchIndex: bi }, index, state);
            walkElement(caseEl, depth + 1, index, state);
        }
        return;
    }
    walkChildren(el.children, el, depth + 1, index, state);
}

/**
 * @param {object} el
 * @param {object | null} parent
 * @param {number} depth
 * @param {{ chain: object, branchIndex: number } | null} chainBranch
 * @param {{ branchIndex: number } | null} matchBranch
 * @param {TemplateIndex} index
 * @param {{ order: number }} state
 */
function annotateElement(el, parent, depth, chainBranch, matchBranch, index, state) {
    el.parent = parent;
    el.depth = depth;
    el.chainBranch = chainBranch;
    el.matchBranch = matchBranch;
    el.order = state.order++;

    // byTag
    pushBucket(index.byTag, el.tagName, el);

    // byId / byClass / byAttrName from static attributes
    for (const [attrName, attrValue] of el.attrs) {
        pushBucket(index.byAttrName, attrName, el);
        if (attrName === 'id' && attrValue !== '') {
            pushBucket(index.byId, attrValue, el);
        } else if (attrName === 'class' && attrValue !== '') {
            for (const cls of attrValue.split(/\s+/)) {
                if (cls === '') continue;
                pushBucket(index.byClass, cls, el);
            }
        }
    }

    if (el.directives && el.directives.include) {
        index.includes.push(el);
    }
}

/**
 * @param {ElementBucket} bucket
 * @param {string} key
 * @param {object} el
 */
function pushBucket(bucket, key, el) {
    const list = bucket.get(key);
    if (list) {
        list.push(el);
    } else {
        bucket.set(key, [el]);
    }
}

/**
 * Return the list of ancestors of `el` that require execution to reach it at
 * render time, ordered root -> parent. An element requires execution when:
 *
 *   - it is a chain branch (the chain's branches must be evaluated to confirm
 *     this branch was chosen);
 *   - it is an x-match case/nocase (the parent x-match's cases must be
 *     evaluated to confirm this branch was chosen);
 *   - it declares x-data (scope frame push);
 *   - it declares x-for or x-each (loop iteration).
 *
 * Other ancestors add nothing structural and can be skipped by the targeted
 * walker.
 *
 * @param {object} el
 * @returns {object[]}
 */
export function computeControlPath(el) {
    const path = [];
    let cur = el.parent;
    while (cur) {
        if (elementRequiresExecution(cur)) path.push(cur);
        cur = cur.parent;
    }
    path.reverse();
    return path;
}

/**
 * @param {object} el
 * @returns {boolean}
 */
export function elementRequiresExecution(el) {
    if (!el || !el.directives) return false;
    if (el.chainBranch) return true;
    if (el.matchBranch) return true;
    if (el.directives.data) return true;
    if (el.directives.for) return true;
    if (el.directives.each) return true;
    return false;
}

/**
 * Return the value of a static attribute on the element, or null if absent.
 *
 * @param {object} el
 * @param {string} name
 * @returns {string | null}
 */
export function getStaticAttr(el, name) {
    for (const [n, v] of el.attrs) {
        if (n === name) return v;
    }
    return null;
}

/**
 * Return the set of static class tokens on the element (may be empty).
 *
 * @param {object} el
 * @returns {Set<string>}
 */
export function getStaticClassSet(el) {
    const raw = getStaticAttr(el, 'class');
    const set = new Set();
    if (raw === null || raw === '') return set;
    for (const cls of raw.split(/\s+/)) {
        if (cls !== '') set.add(cls);
    }
    return set;
}

/**
 * Sort a list of element nodes into document order using their `order` fields
 * assigned by buildTemplateIndex.
 *
 * @param {object[]} elements
 * @returns {object[]}
 */
export function sortByDocumentOrder(elements) {
    return elements.slice().sort((a, b) => a.order - b.order);
}
