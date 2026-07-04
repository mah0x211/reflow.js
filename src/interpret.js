/**
 * @file IR interpreter — walks the IR tree and produces an HTML string.
 *
 * Synchronous render phase. Each directive's render-time behavior is
 * documented on its handler below (renderChain, renderElement,
 * renderElementOnce, resolveBindValue, emitTextContent, emitHtmlContent,
 * emitIncludeContent, postEmitBreakOrThrow).
 */

import { ReflowRuntimeError, ReflowIncludeError } from './errors.js';
import { createEnv, pushFrame, popFrame } from './scope.js';
import { evaluate } from './expr/evaluate.js';
import { escapeText, escapeAttr } from './escape.js';
import { makeSnippet, offsetToLineCol } from './snippet.js';
import { reconstructOpenTag } from './compile.js';

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
