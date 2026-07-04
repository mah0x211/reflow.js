/**
 * @file Compile an HTML template into an IR tree.
 *
 * Uses HTMLRewriter as a SAX-style parser and the scanner as an offset oracle,
 * then performs compile-time validation. The compile-phase steps and Fail-fast
 * checks are documented on compileTemplate.
 */

import { ReflowCompileError } from './errors.js';
import { scanElementRanges } from './scanner.js';
import { runRewriter } from './htmlrewriter.js';
import { makeRoot, makeElement, makeText, makeComment, makeChain, isIgnorableForAdjacency } from './ir.js';
import {
    parseData,
    parseExprValue,
    assertEmptyValue,
    parseFor,
    parseEach,
    KNOWN_DIRECTIVES,
    DIRECTIVE_GROUP,
} from './directives/parsers.js';
import { collectHelperNames } from './expr/evaluate.js';
import { makeSnippet, offsetToLineCol } from './snippet.js';

/**
 * HTML5 void elements — never accept children or a closing tag.
 * onEndTag() cannot be registered on these under html-rewriter-wasm and is
 * a no-op on Workers.
 */
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'source', 'track', 'wbr',
]);

/**
 * Compile a template into an IR tree.
 *
 * Compile phase (one pass per template, async):
 *   1. The scanner pre-collects element open-tag byte ranges (offset oracle).
 *   2. HTMLRewriter is driven as a SAX-style parser with an `on('*', ...)`
 *      handler; the Nth element event is matched to the Nth scanned range
 *      (sanity-checked by tag name).
 *   3. On element open: build an IR node, parse its x-* attributes into
 *      directive metadata, and push it onto a stack.
 *   4. Text/comments become children of the stack top; on element close the
 *      node is popped and attached to its parent. Text chunks are coalesced.
 *   5. After the walk, sibling x-if / [x-elseif]* / [x-else]? chains are
 *      consolidated, and x-match children (x-case / x-nocase) are gathered
 *      into branches; inter-member whitespace/comments are stripped.
 *   6. Compile-time Fail-fast checks: unknown x-* attributes, orphan
 *      x-elseif / x-else / x-case / x-nocase, invalid x-for range / direction,
 *      S/I/K same-element exclusivity, x-text / x-html / x-include conflicts,
 *      unregistered helper references, duplicate x-data, x-break outside a
 *      loop, malformed expression syntax, etc.
 *
 * The result is an immutable IR tree plus the original HTML (kept for snippet
 * generation at render time).
 *
 * @param {object} params
 * @param {string} params.name       Template name (for error messages).
 * @param {string} params.html       Template HTML source.
 * @param {string} params.prefix     Directive prefix (e.g. 'x-').
 * @param {Set<string>} params.helperNames  Registered helper identifiers.
 * @returns {Promise<{ root: object, html: string }>}
 */
export async function compileTemplate({ name, html, prefix, helperNames }) {
    const ranges = scanElementRanges(html);
    let rangeIdx = 0;

    const root = makeRoot();
    /** @type {object[]} */
    const stack = [root];

    /** Coalesce text chunks per text node. */
    let textBuffer = '';

    const flushText = () => {
        if (textBuffer !== '') {
            currentParent(stack).children.push(makeText(textBuffer));
            textBuffer = '';
        }
    };

    const handlers = {
        '*': {
            element(el) {
                flushText();

                // Advance rangeIdx to the first range whose tagName matches this element.
                let range = null;
                while (rangeIdx < ranges.length) {
                    const candidate = ranges[rangeIdx++];
                    if (candidate.tagName === el.tagName) {
                        range = candidate;
                        break;
                    }
                }
                /* c8 ignore start */
                if (!range) {
                    // Scanner and HTMLRewriter diverged — defensive fallback.
                    range = { start: 0, end: 0, tagName: el.tagName };
                }
                /* c8 ignore stop */

                const node = makeElement(el.tagName, range.start, range.end);

                // Collect attributes and split into regular vs directive.
                /** @type {Array<[string, string]>} */
                const rawAttrs = [];
                for (const [attrName, attrValue] of el.attributes) {
                    rawAttrs.push([attrName, attrValue]);
                }

                try {
                    processElementAttributes({
                        node,
                        rawAttrs,
                        prefix,
                        helperNames,
                    });
                } catch (e) {
                    throw makeCompileError(e.message, { html, name, node, cause: e });
                }

                stack.push(node);

                if (!VOID_ELEMENTS.has(el.tagName)) {
                    el.onEndTag(() => {
                        flushText();
                        const finished = stack.pop();
                        const parent = currentParent(stack);
                        try {
                            postProcessChildren(finished, html, name);
                            /* c8 ignore start */
                        } catch (e) {
                            if (e instanceof ReflowCompileError) throw e;
                            throw makeCompileError(e.message, { html, name, node: finished, cause: e });
                        }
                        /* c8 ignore stop */
                        parent.children.push(finished);
                    });
                } else {
                    // Void element: no end tag, no children — finalize now.
                    const finished = stack.pop();
                    currentParent(stack).children.push(finished);
                }
            },
            text(t) {
                textBuffer += t.text;
                if (t.lastInTextNode) {
                    flushText();
                }
            },
            comments(c) {
                flushText();
                currentParent(stack).children.push(makeComment(c.text));
            },
        },
    };

    await runRewriter(html, handlers);
    flushText();

    // Post-process root's children (chain consolidation, loop-context validation).
    postProcessChildren(root, html, name);

    // Global validation pass: verify x-break / x-break-if occur only within a loop.
    validateBreakContext(root, html, name, /*inLoop=*/false);

    return { root, html };
}

/**
 * @param {object[]} stack
 * @returns {object}
 */
function currentParent(stack) {
    return stack[stack.length - 1];
}

/**
 * Parse each attribute of an element. Splits into `attrs` (regular) and
 * `directives` (parsed metadata). Validates directive combinations.
 *
 * @param {{ node: object, rawAttrs: Array<[string, string]>, prefix: string, helperNames: Set<string> }} params
 */
function processElementAttributes({ node, rawAttrs, prefix, helperNames }) {
    const directives = node.directives;
    const groups = new Set();

    for (const [attrName, attrValue] of rawAttrs) {
        if (!attrName.startsWith(prefix)) {
            node.attrs.push([attrName, attrValue]);
            continue;
        }
        const suffix = attrName.slice(prefix.length);

        // x-bind:<name>
        if (suffix.startsWith('bind:')) {
            const targetAttr = suffix.slice('bind:'.length);
            if (!targetAttr) {
                throw new Error(`${attrName}: attribute name after "bind:" is required`);
            }
            const expr = parseExprValue(attrValue, attrName);
            checkHelpers(expr, helperNames, attrName);
            (directives.bind ??= []).push({ attrName: targetAttr, expr });
            groups.add('A');
            continue;
        }

        if (!KNOWN_DIRECTIVES.has(suffix)) {
            throw new Error(`unknown directive "${attrName}"`);
        }

        switch (suffix) {
            case 'data': {
                if (directives.data) throw new Error(`duplicate x-data on element`);
                directives.data = parseData(attrValue);
                groups.add('D');
                break;
            }
            case 'if': {
                directives.ifExpr = parseExprValue(attrValue, attrName);
                checkHelpers(directives.ifExpr, helperNames, attrName);
                groups.add('S');
                break;
            }
            case 'elseif': {
                directives.elseIfExpr = parseExprValue(attrValue, attrName);
                checkHelpers(directives.elseIfExpr, helperNames, attrName);
                groups.add('S');
                break;
            }
            case 'else': {
                assertEmptyValue(attrValue, attrName);
                directives.elseMark = true;
                groups.add('S');
                break;
            }
            case 'match': {
                directives.matchExpr = parseExprValue(attrValue, attrName);
                checkHelpers(directives.matchExpr, helperNames, attrName);
                groups.add('S');
                break;
            }
            case 'case': {
                directives.caseExpr = parseExprValue(attrValue, attrName);
                checkHelpers(directives.caseExpr, helperNames, attrName);
                groups.add('S');
                break;
            }
            case 'nocase': {
                assertEmptyValue(attrValue, attrName);
                directives.nocaseMark = true;
                groups.add('S');
                break;
            }
            case 'for': {
                directives.for = parseFor(attrValue);
                groups.add('I');
                break;
            }
            case 'each': {
                directives.each = parseEach(attrValue);
                checkHelpers(directives.each.collection, helperNames, attrName);
                groups.add('I');
                break;
            }
            case 'text': {
                directives.text = { expr: parseExprValue(attrValue, attrName) };
                checkHelpers(directives.text.expr, helperNames, attrName);
                groups.add('C');
                break;
            }
            case 'html': {
                directives.html = { expr: parseExprValue(attrValue, attrName) };
                checkHelpers(directives.html.expr, helperNames, attrName);
                groups.add('C');
                break;
            }
            case 'include': {
                directives.include = { expr: parseExprValue(attrValue, attrName) };
                checkHelpers(directives.include.expr, helperNames, attrName);
                groups.add('C');
                break;
            }
            case 'break': {
                assertEmptyValue(attrValue, attrName);
                directives.breakMark = true;
                groups.add('K');
                break;
            }
            case 'break-if': {
                directives.breakIf = { expr: parseExprValue(attrValue, attrName) };
                checkHelpers(directives.breakIf.expr, helperNames, attrName);
                groups.add('K');
                break;
            }
            /* c8 ignore start */
            default:
                // Unreachable: KNOWN_DIRECTIVES check above guarantees we never fall here.
                throw new Error(`unknown directive "${attrName}"`);
            /* c8 ignore stop */
        }
    }

    // Combination rules
    validateSameElementCombinations(directives, groups);

    // Detect K-only invisible marker
    const isKOnly =
        (directives.breakMark || directives.breakIf) &&
        !(directives.data || directives.ifExpr || directives.elseIfExpr || directives.elseMark ||
            directives.matchExpr || directives.caseExpr || directives.nocaseMark ||
            directives.for || directives.each ||
            directives.text || directives.html || directives.include ||
            (directives.bind && directives.bind.length > 0)) &&
        node.attrs.length === 0;
    if (isKOnly) {
        node.invisibleMarker = true;
    }
}

/**
 * @param {object} directives
 * @param {Set<'D'|'S'|'I'|'C'|'A'|'K'>} groups
 */
function validateSameElementCombinations(directives, groups) {
    // Within-group exclusivity
    const sCount =
        (directives.ifExpr ? 1 : 0) +
        (directives.elseIfExpr ? 1 : 0) +
        (directives.elseMark ? 1 : 0) +
        (directives.matchExpr ? 1 : 0) +
        (directives.caseExpr ? 1 : 0) +
        (directives.nocaseMark ? 1 : 0);
    if (sCount > 1) {
        throw new Error(`conflicting structural directives on same element (x-if / x-elseif / x-else / x-match / x-case / x-nocase are mutually exclusive)`);
    }

    const iCount = (directives.for ? 1 : 0) + (directives.each ? 1 : 0);
    if (iCount > 1) {
        throw new Error(`conflicting iteration directives on same element (x-for / x-each are mutually exclusive)`);
    }

    const cCount =
        (directives.text ? 1 : 0) + (directives.html ? 1 : 0) + (directives.include ? 1 : 0);
    if (cCount > 1) {
        throw new Error(`conflicting content directives on same element (x-text / x-html / x-include are mutually exclusive)`);
    }

    const kCount = (directives.breakMark ? 1 : 0) + (directives.breakIf ? 1 : 0);
    if (kCount > 1) {
        throw new Error(`conflicting control directives on same element (x-break / x-break-if are mutually exclusive)`);
    }

    // Cross-group forbidden pairs
    if (groups.has('S') && groups.has('I')) {
        throw new Error(`cannot combine structural directive with iteration directive on same element; use nesting`);
    }
    if (groups.has('S') && groups.has('K')) {
        throw new Error(`cannot combine structural directive with control directive on same element; use nesting`);
    }
    if (groups.has('I') && groups.has('K')) {
        throw new Error(`cannot combine iteration directive with control directive on same element; place x-break / x-break-if on a child`);
    }
}

/**
 * Verify referenced helper names are registered.
 * @param {object} ast
 * @param {Set<string>} helperNames
 * @param {string} directive
 */
function checkHelpers(ast, helperNames, directive) {
    const names = collectHelperNames(ast);
    for (const n of names) {
        if (!helperNames.has(n)) {
            throw new Error(`${directive}: unknown helper "${n}" — register it via new Reflow({ helpers: { ${n}: fn } })`);
        }
    }
}

/**
 * Post-process an element's children:
 *  - Consolidate x-if / x-elseif / x-else siblings into chain nodes and
 *    strip the whitespace/comments between chain members.
 *  - If the element itself has x-match, gather its direct child x-case /
 *    x-nocase elements, validate, and attach as `matchBranches`; remove
 *    the case/nocase children (their surrounding whitespace is also
 *    removed).
 *
 * @param {object} parent
 * @param {string} html
 * @param {string} name
 */
function postProcessChildren(parent, html, name) {
    // First: chain consolidation and orphan detection
    consolidateChains(parent, html, name);

    // Then: if this element is x-match, validate/collect case children
    if (parent.type === 'element' && parent.directives && parent.directives.matchExpr) {
        collectMatchBranches(parent, html, name);
    }

    // Sanity: orphan x-case / x-nocase / x-elseif / x-else outside their proper context
    detectOrphans(parent, html, name);
}

/**
 * Walk children and replace `x-if [x-elseif]* [x-else]?` sequences with a
 * chain node. Whitespace/comment siblings between chain members are
 * discarded from output.
 *
 * @param {object} parent
 * @param {string} html
 * @param {string} name
 */
function consolidateChains(parent, html, name) {
    const out = [];
    const oldChildren = parent.children;
    let i = 0;

    while (i < oldChildren.length) {
        const child = oldChildren[i];
        if (child.type === 'element' && child.directives && child.directives.ifExpr) {
            // Start of a chain
            const branches = [{ cond: child.directives.ifExpr, node: child }];
            let j = i + 1;
            // `chainConsumedUpTo` tracks the index just past the last chain member,
            // so if we scan ahead through whitespace/comments and find a non-chain
            // element, we rewind to preserve that whitespace/comment.
            let chainConsumedUpTo = j;
            let sawElse = false;
            let chainEnd = child.sourceEnd;

            while (j < oldChildren.length) {
                const sib = oldChildren[j];
                if (isIgnorableForAdjacency(sib)) {
                    j++;
                    continue;
                }
                if (sib.type !== 'element' || !sib.directives) break;

                if (sib.directives.elseIfExpr) {
                    if (sawElse) {
                        throw makeCompileError(
                            `x-elseif after x-else is not allowed`,
                            { html, name, node: sib }
                        );
                    }
                    branches.push({ cond: sib.directives.elseIfExpr, node: sib });
                    chainEnd = sib.sourceEnd;
                    j++;
                    chainConsumedUpTo = j;
                    continue;
                }
                if (sib.directives.elseMark) {
                    if (sawElse) {
                        throw makeCompileError(
                            `multiple x-else in the same chain`,
                            { html, name, node: sib }
                        );
                    }
                    branches.push({ cond: null, node: sib });
                    chainEnd = sib.sourceEnd;
                    sawElse = true;
                    j++;
                    chainConsumedUpTo = j;
                    continue;
                }
                break;
            }

            out.push(makeChain(branches, child.sourceStart, chainEnd));
            // Rewind to the first non-consumed sibling — preserves trailing
            // whitespace/comments after the last chain member.
            i = chainConsumedUpTo;
            continue;
        }

        out.push(child);
        i++;
    }

    parent.children = out;
}

/**
 * Collect x-case / x-nocase children of an x-match parent into
 * `parent.directives.match = { expr, branches }` and clear children.
 *
 * x-match structure rules (per the project's directive spec):
 *   - Every direct child (ignoring whitespace/comments) must be x-case or
 *     x-nocase.
 *   - x-case values are compared to the x-match value top-down; the first
 *     match wins (no fallthrough). Only the chosen branch is emitted.
 *   - x-nocase is the fallback (emitted when no x-case matches) and must be
 *     the LAST child; at most one is allowed.
 *   - At least one x-case is required (a lone x-nocase is rejected).
 *   - x-case / x-nocase appearing anywhere other than as a direct child of
 *     x-match is rejected elsewhere (orphan detection).
 *
 * @param {object} parent
 * @param {string} html
 * @param {string} name
 */
function collectMatchBranches(parent, html, name) {
    const branches = [];
    let sawNocase = false;

    for (const child of parent.children) {
        if (isIgnorableForAdjacency(child)) continue;

        if (child.type !== 'element' || !child.directives) {
            throw makeCompileError(
                `x-match: direct children must be x-case or x-nocase elements (found ${describeChildForError(child)})`,
                { html, name, node: parent }
            );
        }
        const d = child.directives;

        if (d.caseExpr) {
            if (sawNocase) {
                throw makeCompileError(
                    `x-case must not appear after x-nocase in the same x-match`,
                    { html, name, node: child }
                );
            }
            branches.push({ cond: d.caseExpr, node: child });
            continue;
        }
        if (d.nocaseMark) {
            if (sawNocase) {
                throw makeCompileError(
                    `multiple x-nocase in the same x-match`,
                    { html, name, node: child }
                );
            }
            branches.push({ cond: null, node: child });
            sawNocase = true;
            continue;
        }

        throw makeCompileError(
            `x-match: direct children must be x-case or x-nocase elements`,
            { html, name, node: child }
        );
    }

    if (branches.length === 0 || (branches.length === 1 && branches[0].cond === null)) {
        throw makeCompileError(
            `x-match requires at least one x-case`,
            { html, name, node: parent }
        );
    }

    parent.directives.match = {
        expr: parent.directives.matchExpr,
        branches,
    };
    // Clear original children — the match branches supersede them
    parent.children = [];
}

/**
 * Detect orphan x-elseif / x-else that were not consumed by a chain, and
 * orphan x-case / x-nocase that were not consumed by an x-match.
 *
 * @param {object} parent
 * @param {string} html
 * @param {string} name
 */
function detectOrphans(parent, html, name) {
    for (const child of parent.children) {
        if (child.type !== 'element' || !child.directives) continue;
        const d = child.directives;
        if (d.elseIfExpr) {
            throw makeCompileError(
                `x-elseif has no preceding x-if`,
                { html, name, node: child }
            );
        }
        if (d.elseMark) {
            throw makeCompileError(
                `x-else has no preceding x-if / x-elseif`,
                { html, name, node: child }
            );
        }
        if (d.caseExpr) {
            throw makeCompileError(
                `x-case must be a direct child of x-match`,
                { html, name, node: child }
            );
        }
        if (d.nocaseMark) {
            throw makeCompileError(
                `x-nocase must be a direct child of x-match`,
                { html, name, node: child }
            );
        }
    }
}

/**
 * Recursively verify x-break / x-break-if only appear within a loop body.
 *
 * @param {object} node
 * @param {string} html
 * @param {string} name
 * @param {boolean} inLoop
 */
function validateBreakContext(node, html, name, inLoop) {
    if (!node) return;

    if (node.type === 'chain') {
        for (const b of node.branches) {
            validateBreakContext(b.node, html, name, inLoop);
        }
        return;
    }

    if (node.type === 'element') {
        if ((node.directives.breakMark || node.directives.breakIf) && !inLoop) {
            throw makeCompileError(
                `x-break / x-break-if outside of x-for or x-each`,
                { html, name, node }
            );
        }
        const introducesLoop = !!(node.directives.for || node.directives.each);
        // The loop-carrying element itself is not "inside" the loop; its
        // descendants are. But because of R1 (element repetition) and the
        // I/K exclusion rule, x-break can never sit on the loop element
        // itself. We propagate inLoop=true to descendants and match parents.
        const childInLoop = inLoop || introducesLoop;

        // If element has x-match, walk the match branches too.
        if (node.directives.match) {
            for (const b of node.directives.match.branches) {
                validateBreakContext(b.node, html, name, childInLoop);
            }
        }

        for (const child of node.children) {
            validateBreakContext(child, html, name, childInLoop);
        }
        return;
    }

    if (node.type === 'root') {
        for (const child of node.children) {
            validateBreakContext(child, html, name, inLoop);
        }
    }
}

/**
 * @param {object} node
 * @returns {string}
 */
function describeChildForError(node) {
    // Only 'text' actually reaches this at the call site (elements are filtered
    // above, comments are ignorable). Guard for defense against future callers.
    if (node.type === 'text') return `text "${node.text.slice(0, 20)}"`;
    /* c8 ignore next */
    return node.type;
}

/**
 * Build a ReflowCompileError with snippet and location.
 *
 * @param {string} message
 * @param {{ html: string, name: string, node?: object, cause?: Error }} ctx
 * @returns {ReflowCompileError}
 */
function makeCompileError(message, ctx) {
    const meta = {
        templateName: ctx.name,
    };
    if (ctx.node && ctx.node.sourceStart != null) {
        const { line, column } = offsetToLineCol(ctx.html, ctx.node.sourceStart);
        meta.line = line;
        meta.column = column;
        meta.snippet = makeSnippet(ctx.html, ctx.node.sourceStart, ctx.node.sourceEnd);
        if (ctx.node.type === 'element') {
            meta.element = reconstructOpenTag(ctx.node);
        }
    }
    if (ctx.cause) meta.cause = ctx.cause;
    return new ReflowCompileError(message, meta);
}

/**
 * Rebuild a canonical opening tag string from an element IR node.
 * Note: directive attributes are omitted (they are stripped from output).
 * We include a hint of directives so error messages carry that context.
 *
 * @param {object} node
 * @returns {string}
 */
export function reconstructOpenTag(node) {
    const attrParts = [];
    for (const [name, value] of node.attrs) {
        attrParts.push(value === '' || value === true ? name : `${name}="${escapeAttrForDisplay(value)}"`);
    }
    return `<${node.tagName}${attrParts.length ? ' ' + attrParts.join(' ') : ''}>`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeAttrForDisplay(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}
