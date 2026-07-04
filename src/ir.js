/**
 * @file IR node factories and helpers.
 *
 * IR node shapes:
 *
 * Root:
 *   { type: 'root', children: [] }
 *
 * Element:
 *   {
 *     type: 'element',
 *     tagName,
 *     attrs: [[name, value], ...],           // non-directive attributes
 *     directives: {                          // parsed directives
 *       data?: { scopes },
 *       bind?: [{ attrName, expr }, ...],
 *       text?: { expr },
 *       html?: { expr },
 *       include?: { expr },
 *       for?: { varName, start, stop, step },
 *       each?: { itemName, indexName, collection },
 *       match?: { expr, branches: [{ cond, node }] },  // set after post-process
 *       ifExpr?, elseIfExpr?, elseMark?,     // raw x-if/elseif/else markers; consolidated into 'chain'
 *       caseExpr?, nocaseMark?,              // raw x-case/nocase markers; consumed by parent match
 *       breakMark?: true,
 *       breakIf?: { expr },
 *     },
 *     children: [],
 *     sourceStart,
 *     sourceEnd,
 *     invisibleMarker: boolean,              // K-only element skip flag
 *   }
 *
 * Chain (synthetic, replaces if/elseif/else sibling sequence in parent.children):
 *   {
 *     type: 'chain',
 *     branches: [{ cond: AST | null, node: elementIR }, ...],
 *     sourceStart, sourceEnd,
 *   }
 *
 * Text:
 *   { type: 'text', text: string }
 *
 * Comment:
 *   { type: 'comment', text: string }
 */

export function makeRoot() {
    return { type: 'root', children: [] };
}

export function makeElement(tagName, sourceStart, sourceEnd) {
    return {
        type: 'element',
        tagName,
        attrs: [],
        directives: {},
        children: [],
        sourceStart,
        sourceEnd,
        invisibleMarker: false,
    };
}

export function makeText(text) {
    return { type: 'text', text };
}

export function makeComment(text) {
    return { type: 'comment', text };
}

export function makeChain(branches, sourceStart, sourceEnd) {
    return { type: 'chain', branches, sourceStart, sourceEnd };
}

/**
 * Return true if the node is whitespace-only text or a comment.
 * Used to skip such nodes when validating chain / match adjacency.
 *
 * @param {object} node
 * @returns {boolean}
 */
export function isIgnorableForAdjacency(node) {
    if (node.type === 'text' && /^\s*$/.test(node.text)) return true;
    if (node.type === 'comment') return true;
    return false;
}
