/**
 * @file IR interpreter — walks the IR tree and produces an HTML string.
 *
 * Synchronous render phase. Each directive's render-time behavior is
 * documented on its handler below (renderChain, renderElement,
 * renderElementOnce, resolveBindValue, emitTextContent, emitHtmlContent,
 * emitIncludeContent, postEmitBreakOrThrow).
 *
 * `renderFragment` (bottom of file) is the entry point for CSS-selector
 * fragment extraction. It reuses the same primitives but drives the walk
 * from resolved candidate elements rather than from the template root.
 */

import { ReflowRuntimeError, ReflowIncludeError, ReflowSelectorError } from './errors.js';
import { createEnv, pushFrame, popFrame } from './scope.js';
import { evaluate } from './expr/evaluate.js';
import { escapeText, escapeAttr } from './escape.js';
import { makeSnippet, offsetToLineCol } from './snippet.js';
import { reconstructOpenTag } from './compile.js';
import { computeControlPath } from './selector/index.js';
import { resolveSelector, evalPositional } from './selector/resolve.js';

/**
 * HTML5 void elements — never have a closing tag.
 * See https://html.spec.whatwg.org/multipage/syntax.html#void-elements
 */
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'source', 'track', 'wbr',
]);

/**
 * Sentinel used to unwind the render stack when a break fires. Not a real
 * Error to avoid interference with helper-thrown exceptions.
 */
class BreakSignal { }

/**
 * Render a compiled template (synchronous).
 *
 * Render phase: initialize the environment ($ = data; empty scope stack; empty
 * include stack), push this template onto the include stack, recursively walk
 * the IR appending HTML to an output buffer, pop the include stack, and return
 * the joined string. Helper calls, scope resolution, and escaping all happen
 * inside the walk; a BreakSignal unwinds the stack while keeping open tags
 * balanced.
 *
 * @param {object} params
 * @param {string} params.name         Template name (for error context).
 * @param {object} params.compiled     Result of compileTemplate — { root, html }.
 * @param {object} params.data         Globals ($).
 * @param {Record<string, Function>} params.helpers
 * @param {Map<string, object>} params.templates  All registered templates (for x-include).
 * @param {number} params.maxIncludeDepth
 * @param {string[]} [params.includeStack]
 * @returns {string}
 */
export function render({ name, compiled, data, helpers, templates, maxIncludeDepth, includeStack }) {
    const env = createEnv(data);
    const ctx = {
        name,
        html: compiled.html,
        helpers,
        templates,
        maxIncludeDepth,
        includeStack: includeStack ?? [],
        out: [],
    };
    ctx.includeStack.push(name);
    try {
        renderChildren(compiled.root.children, env, ctx);
    } finally {
        ctx.includeStack.pop();
    }
    return ctx.out.join('');
}

/**
 * @param {object[]} children
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderChildren(children, env, ctx) {
    for (const child of children) {
        renderNode(child, env, ctx);
    }
}

/**
 * @param {object} node
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderNode(node, env, ctx) {
    switch (node.type) {
        case 'text':
            ctx.out.push(node.text);
            return;
        case 'comment':
            ctx.out.push('<!--' + node.text + '-->');
            return;
        case 'chain':
            renderChain(node, env, ctx);
            return;
        case 'element':
            renderElement(node, env, ctx);
            return;
        /* c8 ignore start */
        default:
            // Unknown IR node type — defensive fallback.
            return;
        /* c8 ignore stop */
    }
}

/**
 * Render an x-if / [x-elseif]* / [x-else]? chain. Branches are evaluated
 * top-down; the first truthy branch (or the value-less x-else branch) is
 * rendered and the rest are skipped entirely. Whitespace/comments between
 * chain members were already stripped at compile time.
 *
 * @param {object} chainNode
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderChain(chainNode, env, ctx) {
    for (const branch of chainNode.branches) {
        let matched = false;
        if (branch.cond === null) {
            matched = true;
        } else {
            const v = safeEvaluate(branch.cond, env, ctx, branch.node);
            matched = !!v;
        }
        if (matched) {
            renderElement(branch.node, env, ctx);
            return;
        }
    }
}

/**
 * Dispatch an element by its structural / iteration directive:
 *   x-match  evaluate the parent value and render the element with only the
 *            matching x-case (or x-nocase) branch as its content.
 *   x-for    repeat the element itself over the inclusive integer range,
 *            pushing a loop frame with the loop variable each iteration.
 *   x-each   repeat the element itself over the array, pushing a loop frame
 *            with the item (and optional index) each iteration.
 * Otherwise render once, then run the post-emit break check. A BreakSignal
 * from within a loop pops the frame and stops iterating.
 *
 * @param {object} node
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderElement(node, env, ctx) {
    const d = node.directives;

    // x-match — parent element renders normally; its children are the match branches.
    if (d.match) {
        // Determine selected branch
        const matchValue = safeEvaluate(d.match.expr, env, ctx, node);
        let selectedNode = null;
        for (const b of d.match.branches) {
            if (b.cond === null) {
                selectedNode = b.node;
                break;
            }
            const caseValue = safeEvaluate(b.cond, env, ctx, b.node);
            if (matchValue === caseValue) {
                selectedNode = b.node;
                break;
            }
        }
        // Render this element with the selected branch as its only content
        emitElementWithBody(node, env, ctx, () => {
            if (selectedNode) renderElement(selectedNode, env, ctx);
        });
        return;
    }

    // x-for
    if (d.for) {
        const { varName, start, stop, step } = d.for;
        const ascending = step > 0;
        for (let i = start; ascending ? i <= stop : i >= stop; i += step) {
            pushFrame(env, 'loop', { [varName]: i });
            try {
                renderElementOnce(node, env, ctx);
            } catch (sig) {
                if (sig instanceof BreakSignal) {
                    popFrame(env);
                    return;
                }
                throw sig;
            }
            popFrame(env);
        }
        return;
    }

    // x-each
    if (d.each) {
        const collection = safeEvaluate(d.each.collection, env, ctx, node);
        if (!Array.isArray(collection)) {
            throw makeRuntimeError(
                `x-each: expected array, got ${describeValue(collection)}`,
                ctx, node, { directive: 'x-each' }
            );
        }
        const { itemName, indexName } = d.each;
        for (let i = 0; i < collection.length; i++) {
            const frame = { [itemName]: collection[i] };
            if (indexName) frame[indexName] = i;
            pushFrame(env, 'loop', frame);
            try {
                renderElementOnce(node, env, ctx);
            } catch (sig) {
                if (sig instanceof BreakSignal) {
                    popFrame(env);
                    return;
                }
                throw sig;
            }
            popFrame(env);
        }
        return;
    }

    // Non-looping, non-match element
    renderElementOnce(node, env, ctx);
    postEmitBreakOrThrow(node, env, ctx);
}

/**
 * Emit the element once (open tag + attrs + body + close tag). Skips entirely
 * for invisible-marker elements (an element carrying only x-break /
 * x-break-if). A x-data frame is pushed before evaluating anything (x-bind may
 * reference it) and popped afterwards. Per iteration the order is: x-bind
 * attributes, then content (x-text / x-html / x-include), then emit open tag +
 * content + close tag. x-text / x-html / x-include are mutually exclusive and
 * override any existing children.
 *
 * @param {object} node
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderElementOnce(node, env, ctx) {
    const d = node.directives;

    // Invisible marker: entire element and its subtree are skipped.
    // (Post-emit break check for this element is handled by the caller
    // in renderElement's non-loop branch.)
    if (node.invisibleMarker) return;

    // Push x-data frame BEFORE evaluating anything else (x-bind may reference it)
    const hasData = !!d.data;
    if (hasData) {
        pushFrame(env, 'data', d.data.scopes);
    }

    try {
        emitElementWithBody(node, env, ctx, () => {
            // Body content resolution
            if (d.text) {
                const v = safeEvaluate(d.text.expr, env, ctx, node);
                emitTextContent(v, ctx, node, 'x-text');
            } else if (d.html) {
                const v = safeEvaluate(d.html.expr, env, ctx, node);
                emitHtmlContent(v, ctx, node);
            } else if (d.include) {
                const v = safeEvaluate(d.include.expr, env, ctx, node);
                emitIncludeContent(v, env, ctx, node);
            } else {
                renderChildren(node.children, env, ctx);
            }
        });
    } finally {
        if (hasData) popFrame(env);
    }
}

/**
 * Emit `<tag ...attrs>` + body + `</tag>` unless it's a void element (no
 * closing tag emitted). The `body` callback is invoked between the tags.
 *
 * When a BreakSignal propagates through `body`, the close tag is still
 * emitted (to keep HTML well-formed), then the signal is rethrown so the
 * enclosing loop can catch it.
 *
 * @param {object} node
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @param {() => void} body
 */
function emitElementWithBody(node, env, ctx, body) {
    ctx.out.push(renderOpenTag(node, env, ctx));

    if (VOID_ELEMENTS.has(node.tagName)) {
        // Void elements: emit body content but no close tag.
        // Break signals from a void body are structurally impossible (no children),
        // but the guard is retained for defense against internal misuse.
        /* c8 ignore start */
        let sig = null;
        try {
            body();
        } catch (e) {
            if (e instanceof BreakSignal) sig = e;
            else throw e;
        }
        if (sig) throw sig;
        /* c8 ignore stop */
        return;
    }

    let sig = null;
    try {
        body();
    } catch (e) {
        if (e instanceof BreakSignal) sig = e;
        else throw e;
    }
    ctx.out.push('</' + node.tagName + '>');
    if (sig) throw sig;
}

/**
 * Build the opening tag string with regular attrs + x-bind computed attrs.
 * Strips consumed x-* attributes (they are absent from node.attrs by
 * construction). If x-bind targets an attribute that also exists in
 * node.attrs, the bind result wins.
 *
 * @param {object} node
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @returns {string}
 */
function renderOpenTag(node, env, ctx) {
    // Compute x-bind attribute values first so we can override / omit.
    /** @type {Map<string, string | true | null>} */
    const boundAttrs = new Map();

    if (node.directives.bind) {
        for (const b of node.directives.bind) {
            const value = safeEvaluate(b.expr, env, ctx, node);
            const emitted = resolveBindValue(value, b.attrName, node, ctx);
            boundAttrs.set(b.attrName, emitted);
        }
    }

    const parts = [];
    const seen = new Set();

    for (const [attrName, attrValue] of node.attrs) {
        if (boundAttrs.has(attrName)) {
            // x-bind overrides original
            const bv = boundAttrs.get(attrName);
            seen.add(attrName);
            appendAttr(parts, attrName, bv);
            continue;
        }
        seen.add(attrName);
        // Original attribute — pass through with proper escaping
        // Note: HTMLRewriter provides decoded values; we re-escape on output.
        parts.push(`${attrName}="${escapeAttr(attrValue)}"`);
    }

    // Any x-bind attrs not seen in original attrs — emit if truthy
    for (const [attrName, bv] of boundAttrs) {
        if (seen.has(attrName)) continue;
        appendAttr(parts, attrName, bv);
    }

    return `<${node.tagName}${parts.length ? ' ' + parts.join(' ') : ''}>`;
}

/**
 * Resolve an x-bind evaluated value per the directive spec's type rules:
 *   null / undefined / false          -> null     (omit the attribute)
 *   true                              -> true     (bare attribute name)
 *   '' / 0 / number / string / bigint -> String(v) (emit as the value)
 *   object / array                    -> Fail-fast
 * If the same attribute exists on the original element, the bind result wins.
 *
 * @param {unknown} v
 * @param {string} attrName
 * @param {object} node
 * @param {object} ctx
 * @returns {string | true | null}
 */
function resolveBindValue(v, attrName, node, ctx) {
    if (v === null || v === undefined || v === false) return null;
    if (v === true) return true;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') {
        return String(v);
    }
    throw makeRuntimeError(
        `x-bind:${attrName}: value must be primitive, got ${describeValue(v)}`,
        ctx, node, { directive: `x-bind:${attrName}`, attribute: attrName }
    );
}

/**
 * @param {string[]} parts
 * @param {string} attrName
 * @param {string | true | null} value
 */
function appendAttr(parts, attrName, value) {
    if (value === null) return;
    if (value === true) {
        parts.push(attrName);
        return;
    }
    parts.push(`${attrName}="${escapeAttr(value)}"`);
}

/**
 * Emit x-text body content. null / undefined emit nothing; the value is
 * HTML-escaped (OWASP set). An object or array value is Fail-fast (avoids
 * meaningless output).
 *
 * @param {unknown} value
 * @param {object} ctx
 * @param {object} node
 * @param {string} directive
 */
function emitTextContent(value, ctx, node, directive) {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
        throw makeRuntimeError(
            `${directive}: value must be primitive, got ${describeValue(value)}`,
            ctx, node, { directive }
        );
    }
    ctx.out.push(escapeText(value));
}

/**
 * Emit x-html body content as raw HTML (no escaping — XSS is the template
 * author's responsibility). null / undefined emit nothing; any non-string
 * value is Fail-fast.
 *
 * @param {unknown} value
 * @param {object} ctx
 * @param {object} node
 */
function emitHtmlContent(value, ctx, node) {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string') {
        throw makeRuntimeError(
            `x-html: value must be string, null, or undefined, got ${describeValue(value)}`,
            ctx, node, { directive: 'x-html' }
        );
    }
    ctx.out.push(value);
}

/**
 * Emit x-include body content: resolve the value to a template name and render
 * that template inline. The included template gets the SAME globals ($) but a
 * FRESH lexical scope (the parent's x-data and loop variables are not visible).
 * Fail-fast (ReflowIncludeError) when: the value is not a string, the template
 * is not registered (not_found), the include depth exceeds the limit
 * (depth_exceeded), or the same template re-enters (cycle).
 *
 * @param {unknown} value
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @param {object} node
 */
function emitIncludeContent(value, env, ctx, node) {
    if (typeof value !== 'string') {
        throw makeIncludeError(
            `x-include: value must evaluate to a template name (string), got ${describeValue(value)}`,
            ctx, node, { reason: 'invalid', requested: value }
        );
    }

    const targetName = value;
    const target = ctx.templates.get(targetName);
    if (!target) {
        throw makeIncludeError(
            `template not found: "${targetName}"`,
            ctx, node, { reason: 'not_found', requested: targetName }
        );
    }

    if (ctx.includeStack.length >= ctx.maxIncludeDepth) {
        throw makeIncludeError(
            `include depth limit exceeded (${ctx.maxIncludeDepth})`,
            ctx, node, { reason: 'depth_exceeded', requested: targetName }
        );
    }

    if (ctx.includeStack.includes(targetName)) {
        throw makeIncludeError(
            `include cycle detected`,
            ctx, node, { reason: 'cycle', requested: targetName }
        );
    }

    // Render with fresh lexical scope, same globals
    const rendered = render({
        name: targetName,
        compiled: target,
        data: env.globals,
        helpers: ctx.helpers,
        templates: ctx.templates,
        maxIncludeDepth: ctx.maxIncludeDepth,
        includeStack: ctx.includeStack,
    });
    ctx.out.push(rendered);
}

/**
 * Evaluate x-break / x-break-if AFTER the element has fully emitted, and throw
 * a BreakSignal to unwind to the innermost enclosing loop (there is no labeled
 * break). The signal keeps open tags balanced as it unwinds. x-break always
 * fires; x-break-if fires only when its expression is truthy.
 *
 * @param {object} node
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function postEmitBreakOrThrow(node, env, ctx) {
    const d = node.directives;
    if (d.breakMark) {
        throw new BreakSignal();
    }
    if (d.breakIf) {
        const v = safeEvaluate(d.breakIf.expr, env, ctx, node);
        if (v) throw new BreakSignal();
    }
}

/**
 * Evaluate an expression, wrapping errors into ReflowRuntimeError with
 * template context.
 *
 * @param {object} ast
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @param {object} node
 * @returns {unknown}
 */
function safeEvaluate(ast, env, ctx, node) {
    try {
        return evaluate(ast, env, ctx.helpers);
    } catch (e) {
        /* c8 ignore next */
        if (e instanceof ReflowRuntimeError || e instanceof ReflowIncludeError) throw e;
        throw makeRuntimeError(
            e.message,
            ctx, node,
            { expression: ast?.source, cause: e }
        );
    }
}

/**
 * @param {string} message
 * @param {object} ctx
 * @param {object} node
 * @param {object} [extra]
 * @returns {ReflowRuntimeError}
 */
function makeRuntimeError(message, ctx, node, extra = {}) {
    const meta = {
        templateName: ctx.name,
        includeStack: [...ctx.includeStack],
    };
    if (node && node.sourceStart != null) {
        const { line, column } = offsetToLineCol(ctx.html, node.sourceStart);
        meta.line = line;
        meta.column = column;
        meta.snippet = makeSnippet(ctx.html, node.sourceStart, node.sourceEnd);
        if (node.type === 'element') meta.element = reconstructOpenTag(node);
    }
    Object.assign(meta, extra);
    return new ReflowRuntimeError(message, meta);
}

/**
 * @param {string} message
 * @param {object} ctx
 * @param {object} node
 * @param {object} extra
 * @returns {ReflowIncludeError}
 */
function makeIncludeError(message, ctx, node, extra) {
    const meta = {
        templateName: ctx.name,
        includeStack: [...ctx.includeStack],
    };
    if (node && node.sourceStart != null) {
        const { line, column } = offsetToLineCol(ctx.html, node.sourceStart);
        meta.line = line;
        meta.column = column;
        meta.snippet = makeSnippet(ctx.html, node.sourceStart, node.sourceEnd);
        if (node.type === 'element') meta.element = reconstructOpenTag(node);
    }
    Object.assign(meta, extra);
    return new ReflowIncludeError(message, meta);
}

/**
 * Human-readable description of a value's runtime type for error messages.
 * @param {unknown} v
 * @returns {string}
 */
function describeValue(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    const t = typeof v;
    return t === 'object' ? 'object' : t;
}

// -------------------------------------------------------------------------
// Selector fragment rendering
// -------------------------------------------------------------------------

/**
 * Render only the element(s) matching a CSS selector and return their outer
 * HTML. Enforces the single-fragment contract: exactly one runtime element
 * must match, otherwise `ReflowSelectorError` fires with `reason` of
 * 'no_match' or 'multiple_matches'.
 *
 * Strategy:
 *   1. `resolveSelector` returns candidates in the current template. If the
 *      selector has no positional pseudo-classes and the candidate has no
 *      control-flow ancestors nor iteration/scope directives of its own, we
 *      render it standalone. Otherwise we walk the ancestor `controlPath`
 *      to reach the candidate's scope and render it there — this handles
 *      x-data / x-if / x-for / x-each / x-match branching correctly while
 *      still skipping unrelated subtrees.
 *   2. If the selector has positional pseudo-classes, we render the
 *      candidate's parent's direct children with per-emission tracking,
 *      buffer each candidate emission independently, and confirm the
 *      matching one(s) once totals are known.
 *   3. If the current template yielded zero static candidates but has
 *      x-include-bearing elements, walk to each include, execute it, and
 *      recurse into the target template with the same selector. Matches
 *      are accumulated in a shared state so the single-fragment contract
 *      applies across include boundaries.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {object} params.compiled
 * @param {object} params.data
 * @param {Record<string, Function>} params.helpers
 * @param {Map<string, object>} params.templates
 * @param {number} params.maxIncludeDepth
 * @param {import('./selector/parse.js').CompiledSelector} params.selector
 * @param {string[]} [params.includeStack]
 * @returns {string}
 */
export function renderFragment({ name, compiled, data, helpers, templates, maxIncludeDepth, selector, includeStack }) {
    const state = { matches: [], stopAfter: 2 };
    const env = createEnv(data);
    const ctx = {
        name,
        html: compiled.html,
        helpers,
        templates,
        maxIncludeDepth,
        includeStack: includeStack ?? [],
        out: [], // discarded — actual capture happens via candidate buffers
        selector,
        selectorState: state,
        _rootChildren: compiled.root.children,
    };
    ctx.includeStack.push(name);
    try {
        searchTemplate(compiled, env, ctx);
    } finally {
        ctx.includeStack.pop();
    }
    return finalizeMatches(state, name, selector);
}

/**
 * Search a compiled template for selector matches, appending each into
 * `ctx.selectorState.matches`. Returns early once we already have enough
 * matches to know we've exceeded the single-fragment limit.
 *
 * @param {object} compiled
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function searchTemplate(compiled, env, ctx) {
    const state = ctx.selectorState;
    const candidates = resolveSelector(compiled.index, ctx.selector);

    if (candidates.length > 0) {
        for (const cand of candidates) {
            if (state.matches.length >= state.stopAfter) return;
            renderCandidate(compiled, cand, env, ctx);
        }
        return;
    }

    // Cross-template fallback: only walked when the current template contributed
    // zero static candidates.
    if (compiled.index.includes.length === 0) return;
    for (const includeEl of compiled.index.includes) {
        if (state.matches.length >= state.stopAfter) return;
        renderIncludeSearch(compiled, includeEl, env, ctx);
    }
}

/**
 * Materialize a single candidate. Selects the correct rendering path based on
 * whether positional pseudo-classes must be confirmed against runtime sibling
 * counts.
 *
 * @param {object} compiled
 * @param {import('./selector/resolve.js').SelectorCandidate} cand
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderCandidate(compiled, cand, env, ctx) {
    if (cand.positional.length === 0) {
        renderCandidateDirect(cand.element, env, ctx);
    } else {
        renderCandidatePositional(cand.element, cand.positional, env, ctx);
    }
}

/**
 * Render a candidate with no positional constraint: walk to the parent's
 * scope, verify the target's own branch selection (chain/match), then render
 * the candidate itself. Each x-each / x-for iteration is treated as an
 * independent emission and gets its own match entry.
 *
 * @param {object} target
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderCandidateDirect(target, env, ctx) {
    const path = computeControlPath(target);
    walkControlPath(path, 0, env, ctx, () => {
        if (!checkOwnBranch(target, env, ctx)) return;
        renderIterationsCapturing(target, env, ctx);
    });
}

/**
 * If the target is itself a chain branch (x-if / x-elseif / x-else) or an
 * x-match case, evaluate the enclosing chain / match to confirm this branch
 * is the one selected at runtime. Returns false when the target's branch is
 * not selected (candidate is unreachable) and true otherwise.
 *
 * @param {object} target
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @returns {boolean}
 */
function checkOwnBranch(target, env, ctx) {
    if (target.chainBranch) {
        const { chain, branchIndex } = target.chainBranch;
        for (let i = 0; i < chain.branches.length; i++) {
            const br = chain.branches[i];
            const selected = br.cond === null
                ? true
                : !!safeEvaluate(br.cond, env, ctx, br.node);
            if (selected) return i === branchIndex;
        }
        return false;
    }
    if (target.matchBranch) {
        const matchEl = target.parent;
        const matchDir = matchEl.directives.match;
        const matchValue = safeEvaluate(matchDir.expr, env, ctx, matchEl);
        for (let i = 0; i < matchDir.branches.length; i++) {
            const br = matchDir.branches[i];
            let selected;
            if (br.cond === null) selected = true;
            else {
                const caseValue = safeEvaluate(br.cond, env, ctx, br.node);
                selected = (matchValue === caseValue);
            }
            if (selected) return i === target.matchBranch.branchIndex;
        }
        return false;
    }
    return true;
}

/**
 * Capture each top-level emission of `target` (one for a plain element, N for
 * x-for / x-each, 1 for x-match / x-include) as a separate match string.
 *
 * @param {object} target
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderIterationsCapturing(target, env, ctx) {
    const d = target.directives;

    if (d.for) {
        const { varName, start, stop, step: stepVal } = d.for;
        const ascending = stepVal > 0;
        for (let i = start; ascending ? i <= stop : i >= stop; i += stepVal) {
            if (ctx.selectorState.matches.length >= ctx.selectorState.stopAfter) return;
            pushFrame(env, 'loop', { [varName]: i });
            try {
                captureEmission(() => renderElementOnce(target, env, ctx), ctx, target);
            } catch (sig) {
                if (sig instanceof BreakSignal) {
                    popFrame(env);
                    return;
                }
                throw sig;
            }
            popFrame(env);
        }
        return;
    }
    if (d.each) {
        const collection = safeEvaluate(d.each.collection, env, ctx, target);
        if (!Array.isArray(collection)) {
            throw makeRuntimeError(
                `x-each: expected array, got ${describeValue(collection)}`,
                ctx, target, { directive: 'x-each' }
            );
        }
        const { itemName, indexName } = d.each;
        for (let i = 0; i < collection.length; i++) {
            if (ctx.selectorState.matches.length >= ctx.selectorState.stopAfter) return;
            const frame = { [itemName]: collection[i] };
            if (indexName) frame[indexName] = i;
            pushFrame(env, 'loop', frame);
            try {
                captureEmission(() => renderElementOnce(target, env, ctx), ctx, target);
            } catch (sig) {
                if (sig instanceof BreakSignal) {
                    popFrame(env);
                    return;
                }
                throw sig;
            }
            popFrame(env);
        }
        return;
    }

    // renderElement handles x-match; renderElementOnce handles the rest.
    // Delegating to renderElement keeps x-match / invisibleMarker handling in
    // one place, and post-emit break checks stay untouched because breaks are
    // only valid inside loops (which we handled above).
    captureEmission(() => renderElement(target, env, ctx), ctx, target);
}

/**
 * Render a candidate that carries positional pseudo-class predicates. Walk
 * to the candidate's parent scope (including the parent's own branch
 * selection and iteration), then walk the parent's direct children with
 * per-emission tracking, buffer the candidate's emissions, and confirm
 * matches once the sibling totals are known.
 *
 * @param {object} target
 * @param {import('./selector/parse.js').PseudoCond[]} positional
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderCandidatePositional(target, positional, env, ctx) {
    const parent = target.parent;
    if (!parent) {
        // Root-level candidate: use the template root's children directly.
        // Root has no scope / branch / iteration to execute.
        walkAndTrackChildren(target, positional, null, ctx._rootChildren, env, ctx);
        return;
    }
    const parentPath = computeControlPath(parent);
    walkControlPath(parentPath, 0, env, ctx, () => {
        if (!checkOwnBranch(parent, env, ctx)) return;
        executeParentIterations(parent, target, positional, env, ctx);
    });
}

/**
 * Iterate the parent element's x-for / x-each contexts (each iteration is
 * an independent parent-render), push x-data if present, and dispatch to
 * the tracking walker. Handles x-match parents by evaluating the case
 * selection and treating the chosen case as the parent's single element
 * child.
 *
 * @param {object} parent
 * @param {object} target
 * @param {import('./selector/parse.js').PseudoCond[]} positional
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function executeParentIterations(parent, target, positional, env, ctx) {
    const d = parent.directives ?? {};
    const state = ctx.selectorState;

    const dispatch = () => {
        if (d.match) {
            // x-match: the parent's children were cleared at compile time.
            // Siblings for positional purposes are the case branches, but at
            // runtime only the chosen case is emitted (so total = 0 or 1).
            const matchValue = safeEvaluate(d.match.expr, env, ctx, parent);
            let selectedNode = null;
            for (const br of d.match.branches) {
                if (br.cond === null) { selectedNode = br.node; break; }
                const caseValue = safeEvaluate(br.cond, env, ctx, br.node);
                if (matchValue === caseValue) { selectedNode = br.node; break; }
            }
            if (!selectedNode) return; // no case matched, no nocase fallback
            if (selectedNode !== target) return; // some other case is the chosen one
            walkAndTrackChildren(target, positional, parent, [target], env, ctx);
            return;
        }
        walkAndTrackChildren(target, positional, parent, parent.children, env, ctx);
    };

    const withData = (fn) => {
        if (d.data) {
            pushFrame(env, 'data', d.data.scopes);
            try { fn(); } finally { popFrame(env); }
        } else {
            fn();
        }
    };

    if (d.for) {
        const { varName, start, stop, step: stepVal } = d.for;
        const ascending = stepVal > 0;
        for (let i = start; ascending ? i <= stop : i >= stop; i += stepVal) {
            if (state.matches.length >= state.stopAfter) return;
            pushFrame(env, 'loop', { [varName]: i });
            try { withData(dispatch); } finally { popFrame(env); }
        }
        return;
    }
    if (d.each) {
        const collection = safeEvaluate(d.each.collection, env, ctx, parent);
        if (!Array.isArray(collection)) {
            throw makeRuntimeError(
                `x-each: expected array, got ${describeValue(collection)}`,
                ctx, parent, { directive: 'x-each' }
            );
        }
        const { itemName, indexName } = d.each;
        for (let i = 0; i < collection.length; i++) {
            if (state.matches.length >= state.stopAfter) return;
            const frame = { [itemName]: collection[i] };
            if (indexName) frame[indexName] = i;
            pushFrame(env, 'loop', frame);
            try { withData(dispatch); } finally { popFrame(env); }
        }
        return;
    }

    withData(dispatch);
}

/**
 * Walk `siblings` (a parent element's direct children after chain
 * consolidation) with per-emission position tracking. Whenever an emission
 * corresponds to `target`, capture its output into a buffer. At the end,
 * evaluate positional predicates against the collected sibling counts and
 * push matching outputs onto `ctx.selectorState.matches`.
 *
 * @param {object} target
 * @param {import('./selector/parse.js').PseudoCond[]} positional
 * @param {object | null} ownerNode          The parent element (unused, kept
 *                                            for future error context).
 * @param {object[]} siblings
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function walkAndTrackChildren(target, positional, ownerNode, siblings, env, ctx) {
    void ownerNode;
    const frame = {
        total: 0,
        byTag: new Map(),
        emissions: [],     // { buffer: string, index: number, ofTypeIndex: number, tag: string }
    };

    for (const child of siblings) {
        trackChildEmissions(child, target, env, ctx, frame);
        if (ctx.selectorState.matches.length >= ctx.selectorState.stopAfter) return;
    }

    // Now that totals are known, evaluate predicates on each candidate emission.
    for (const em of frame.emissions) {
        const pos = {
            index: em.index,
            total: frame.total,
            ofTypeIndex: em.ofTypeIndex,
            ofTypeTotal: frame.byTag.get(em.tag) ?? 0,
        };
        if (positional.every(p => evalPositional(p, pos))) {
            ctx.selectorState.matches.push({ templateName: ctx.name, output: em.buffer });
            if (ctx.selectorState.matches.length >= ctx.selectorState.stopAfter) return;
        }
    }
}

/**
 * Walk a single child node of a tracked parent, incrementing emission
 * counters and buffering the target's emissions.
 *
 * @param {object} child
 * @param {object} target
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @param {{ total: number, byTag: Map<string, number>, emissions: Array<{ buffer: string, index: number, ofTypeIndex: number, tag: string }> }} frame
 */
function trackChildEmissions(child, target, env, ctx, frame) {
    if (child.type === 'text' || child.type === 'comment') return;

    if (child.type === 'chain') {
        // Evaluate branches; at most one emits.
        for (const branch of child.branches) {
            let selected = false;
            if (branch.cond === null) selected = true;
            else selected = !!safeEvaluate(branch.cond, env, ctx, branch.node);
            if (selected) {
                trackElementEmission(branch.node, target, env, ctx, frame);
                return;
            }
        }
        return;
    }

    if (child.type === 'element') {
        trackElementEmission(child, target, env, ctx, frame);
        return;
    }
}

/**
 * Emit a single element that participates in position tracking. Handles
 * x-for / x-each iteration (each iteration = 1 emission) and everything
 * else (1 emission). When the element is the sought target we capture the
 * emission into a buffer for later predicate evaluation.
 *
 * @param {object} el
 * @param {object} target
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @param {{ total: number, byTag: Map<string, number>, emissions: any[] }} frame
 */
function trackElementEmission(el, target, env, ctx, frame) {
    if (el.invisibleMarker) return;
    const d = el.directives;

    if (d.for) {
        const { varName, start, stop, step: stepVal } = d.for;
        const ascending = stepVal > 0;
        for (let i = start; ascending ? i <= stop : i >= stop; i += stepVal) {
            pushFrame(env, 'loop', { [varName]: i });
            try {
                recordEmission(el, target, frame, ctx, () => renderElementOnce(el, env, ctx));
            } catch (sig) {
                if (sig instanceof BreakSignal) {
                    popFrame(env);
                    return;
                }
                throw sig;
            }
            popFrame(env);
        }
        return;
    }
    if (d.each) {
        const collection = safeEvaluate(d.each.collection, env, ctx, el);
        if (!Array.isArray(collection)) {
            throw makeRuntimeError(
                `x-each: expected array, got ${describeValue(collection)}`,
                ctx, el, { directive: 'x-each' }
            );
        }
        const { itemName, indexName } = d.each;
        for (let i = 0; i < collection.length; i++) {
            const frameVars = { [itemName]: collection[i] };
            if (indexName) frameVars[indexName] = i;
            pushFrame(env, 'loop', frameVars);
            try {
                recordEmission(el, target, frame, ctx, () => renderElementOnce(el, env, ctx));
            } catch (sig) {
                if (sig instanceof BreakSignal) {
                    popFrame(env);
                    return;
                }
                throw sig;
            }
            popFrame(env);
        }
        return;
    }
    // Non-iteration path — delegate to renderElement so x-match is handled once.
    recordEmission(el, target, frame, ctx, () => renderElement(el, env, ctx));
}

/**
 * Emit `el` via `emit()` while recording its runtime position in `frame`.
 * If `el === target`, capture the emission's bytes into a buffer; otherwise
 * discard them but still count the emission.
 *
 * @param {object} el
 * @param {object} target
 * @param {{ total: number, byTag: Map<string, number>, emissions: any[] }} frame
 * @param {object} ctx
 * @param {() => void} emit
 */
function recordEmission(el, target, frame, ctx, emit) {
    frame.total += 1;
    const tag = el.tagName;
    const nextOfType = (frame.byTag.get(tag) ?? 0) + 1;
    frame.byTag.set(tag, nextOfType);

    if (el !== target) {
        // Not the target — discard bytes but drive the walker so nested
        // candidates (unlikely with single-fragment contract, but possible
        // if an ancestor is included in a broader search) still register.
        const savedOut = ctx.out;
        ctx.out = [];
        try { emit(); } finally { ctx.out = savedOut; }
        return;
    }

    // Capture into a fresh buffer so we can preserve the emission independent
    // of the outer discard sink.
    const savedOut = ctx.out;
    const buf = [];
    ctx.out = buf;
    try { emit(); } finally { ctx.out = savedOut; }
    frame.emissions.push({
        buffer: buf.join(''),
        index: frame.total,
        ofTypeIndex: nextOfType,
        tag,
    });
}

/**
 * Run `emit()`, capturing everything written to `ctx.out` into a new buffer.
 * Push the captured string onto `ctx.selectorState.matches` as a confirmed
 * match. Used by the direct (non-positional) candidate path where the
 * candidate itself is unconditionally the target.
 *
 * @param {() => void} emit
 * @param {object} ctx
 * @param {object} target
 */
function captureEmission(emit, ctx, target) {
    void target;
    const savedOut = ctx.out;
    const buf = [];
    ctx.out = buf;
    try {
        emit();
    } finally {
        ctx.out = savedOut;
    }
    ctx.selectorState.matches.push({ templateName: ctx.name, output: buf.join('') });
}

/**
 * Walk a target's controlPath from root toward leaf, executing scope
 * pushes and iteration for each control-flow ancestor. `cont` is invoked
 * from within the accumulated scope so the caller can render the target
 * (or track its parent's siblings).
 *
 * @param {object[]} path
 * @param {number} pathIndex
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @param {() => void} cont
 */
function walkControlPath(path, pathIndex, env, ctx, cont) {
    if (pathIndex >= path.length) {
        cont();
        return;
    }
    const step = path[pathIndex];
    stepControlFlow(step, env, ctx, () => walkControlPath(path, pathIndex + 1, env, ctx, cont));
}

/**
 * Handle a single controlPath step: evaluate chain/match branch selection,
 * iterate x-for/x-each, and push x-data. Invokes `cont` inside the resulting
 * scope. Returns without calling `cont` when the step's branch is not the
 * one leading to the target.
 *
 * @param {object} step
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 * @param {() => void} cont
 */
function stepControlFlow(step, env, ctx, cont) {
    // 1. Branch selection — chain / match. Skip step (and abort) when the
    //    target's branch is not the chosen one.
    if (step.chainBranch) {
        const { chain, branchIndex } = step.chainBranch;
        let chosen = -1;
        for (let i = 0; i < chain.branches.length; i++) {
            const br = chain.branches[i];
            let selected;
            if (br.cond === null) selected = true;
            else selected = !!safeEvaluate(br.cond, env, ctx, br.node);
            if (selected) { chosen = i; break; }
        }
        if (chosen !== branchIndex) return;
    }
    if (step.matchBranch) {
        const matchEl = step.parent;
        const matchDir = matchEl.directives.match;
        const matchValue = safeEvaluate(matchDir.expr, env, ctx, matchEl);
        const wantIndex = step.matchBranch.branchIndex;
        let chosen = -1;
        for (let i = 0; i < matchDir.branches.length; i++) {
            const br = matchDir.branches[i];
            let selected;
            if (br.cond === null) selected = true;
            else {
                const caseValue = safeEvaluate(br.cond, env, ctx, br.node);
                selected = (matchValue === caseValue);
            }
            if (selected) { chosen = i; break; }
        }
        if (chosen !== wantIndex) return;
    }

    // 2. Iteration on the step element itself.
    const d = step.directives;
    const withData = (fn) => {
        if (d.data) {
            pushFrame(env, 'data', d.data.scopes);
            try { fn(); } finally { popFrame(env); }
        } else {
            fn();
        }
    };

    if (d.for) {
        const { varName, start, stop, step: stepVal } = d.for;
        const ascending = stepVal > 0;
        for (let i = start; ascending ? i <= stop : i >= stop; i += stepVal) {
            if (ctx.selectorState.matches.length >= ctx.selectorState.stopAfter) return;
            pushFrame(env, 'loop', { [varName]: i });
            try { withData(cont); } finally { popFrame(env); }
        }
        return;
    }
    if (d.each) {
        const collection = safeEvaluate(d.each.collection, env, ctx, step);
        if (!Array.isArray(collection)) {
            throw makeRuntimeError(
                `x-each: expected array, got ${describeValue(collection)}`,
                ctx, step, { directive: 'x-each' }
            );
        }
        const { itemName, indexName } = d.each;
        for (let i = 0; i < collection.length; i++) {
            if (ctx.selectorState.matches.length >= ctx.selectorState.stopAfter) return;
            const frame = { [itemName]: collection[i] };
            if (indexName) frame[indexName] = i;
            pushFrame(env, 'loop', frame);
            try { withData(cont); } finally { popFrame(env); }
        }
        return;
    }

    withData(cont);
}

/**
 * Walk to an include element, execute it (evaluate expression, run include
 * safety checks, look up the target template) and recurse into the target
 * template's selector search.
 *
 * @param {object} compiled
 * @param {object} includeEl
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function renderIncludeSearch(compiled, includeEl, env, ctx) {
    void compiled;
    const path = computeControlPath(includeEl);
    walkControlPath(path, 0, env, ctx, () => {
        executeIncludeSearch(includeEl, env, ctx);
    });
}

/**
 * At an include element: evaluate the target template name, run the same
 * safety checks as emitIncludeContent, and recurse `searchTemplate` on the
 * target with the current selector.
 *
 * @param {object} includeEl
 * @param {import('./scope.js').Env} env
 * @param {object} ctx
 */
function executeIncludeSearch(includeEl, env, ctx) {
    const d = includeEl.directives;
    const value = safeEvaluate(d.include.expr, env, ctx, includeEl);
    if (typeof value !== 'string') {
        throw makeIncludeError(
            `x-include: value must evaluate to a template name (string), got ${describeValue(value)}`,
            ctx, includeEl, { reason: 'invalid', requested: value }
        );
    }
    const target = ctx.templates.get(value);
    if (!target) {
        throw makeIncludeError(
            `template not found: "${value}"`,
            ctx, includeEl, { reason: 'not_found', requested: value }
        );
    }
    if (ctx.includeStack.length >= ctx.maxIncludeDepth) {
        throw makeIncludeError(
            `include depth limit exceeded (${ctx.maxIncludeDepth})`,
            ctx, includeEl, { reason: 'depth_exceeded', requested: value }
        );
    }
    if (ctx.includeStack.includes(value)) {
        throw makeIncludeError(
            `include cycle detected`,
            ctx, includeEl, { reason: 'cycle', requested: value }
        );
    }

    // Recurse with the same selector state, fresh lexical scope, same globals.
    const nestedEnv = createEnv(env.globals);
    const nestedCtx = {
        ...ctx,
        name: value,
        html: target.html,
        _rootChildren: target.root.children,
    };
    ctx.includeStack.push(value);
    try {
        searchTemplate(target, nestedEnv, nestedCtx);
    } finally {
        ctx.includeStack.pop();
    }
}

/**
 * Finalize match collection: enforce the single-fragment contract.
 *
 * @param {{ matches: Array<{ templateName: string, output: string }> }} state
 * @param {string} entryTemplateName
 * @param {import('./selector/parse.js').CompiledSelector} selector
 * @returns {string}
 */
function finalizeMatches(state, entryTemplateName, selector) {
    if (state.matches.length === 0) {
        throw new ReflowSelectorError(
            `selector "${selector.source}" matched no elements in template "${entryTemplateName}"`,
            {
                reason: 'no_match',
                templateName: entryTemplateName,
                source: selector.source,
            }
        );
    }
    if (state.matches.length > 1) {
        throw new ReflowSelectorError(
            `selector "${selector.source}" matched ${state.matches.length}${state.matches.length >= 2 ? '+' : ''} elements; the single-fragment contract requires exactly one`,
            {
                reason: 'multiple_matches',
                templateName: entryTemplateName,
                source: selector.source,
                matches: state.matches.map(m => ({ templateName: m.templateName })),
            }
        );
    }
    return state.matches[0].output;
}
