/**
 * @file Reflow — public class facade over compile + interpret.
 *
 * The public surface: a configurable constructor plus compile / render
 * methods and uncached static one-shots. Per-method semantics are documented
 * on each member below.
 */

import { ReflowError, ReflowCompileError, ReflowRuntimeError } from './errors.js';
import { compileTemplate } from './compile.js';
import { render as renderCompiled, renderFragment } from './interpret.js';
import { parseSelector } from './selector/parse.js';
import { SelectorCache } from './selector/cache.js';

const DEFAULT_MAX_INCLUDE_DEPTH = 50;
const DEFAULT_PREFIX = 'x-';
const DEFAULT_SELECTOR_CACHE_SIZE = 128;

/**
 * @typedef {object} Config
 * @property {string} [prefix]                           Directive prefix; default 'x-'. Changing it retargets every
 *                                                       directive (e.g. <prefix>data, <prefix>if, <prefix>bind:src) — useful
 *                                                       to avoid clashing with a client-side framework that uses 'x-'.
 *                                                       The $ / @ / . symbols are unaffected.
 * @property {Record<string, Function>} [helpers]        Name -> function map callable from expressions. Fixed at
 *                                                       construction; referencing an unregistered name is Fail-fast at
 *                                                       compile time.
 * @property {(pathname: string) => Promise<string>} [loader]
 *                                                       File-loading hook, required by compileFile / renderFile. The
 *                                                       instance works without it until a file method is called (then
 *                                                       Fail-fast).
 * @property {number} [maxIncludeDepth]                  Upper bound on x-include nesting; default 50. Exceeding it is
 *                                                       Fail-fast at render time.
 * @property {number} [selectorCacheSize]                Upper bound on the internal LRU cache of parsed selectors used
 *                                                       when `render(...)` is called with a raw string; default 128, and
 *                                                       0 disables caching entirely. Only successful parses are inserted
 *                                                       so unbounded invalid input cannot inflate memory. Callers who
 *                                                       want zero-parse hot paths can pre-compile with
 *                                                       `Reflow.compileSelector(source)` and pass the result directly.
 */

export class Reflow {
    /**
     * @param {Config} [config]
     */
    constructor(config = {}) {
        this._prefix = config.prefix ?? DEFAULT_PREFIX;
        this._helpers = { ...(config.helpers ?? {}) };
        this._helperNames = new Set(Object.keys(this._helpers));
        this._loader = config.loader ?? null;
        this._maxIncludeDepth = config.maxIncludeDepth ?? DEFAULT_MAX_INCLUDE_DEPTH;
        /** @type {Map<string, { root: object, html: string, index: object }>} */
        this._templates = new Map();
        this._selectorCache = new SelectorCache(config.selectorCacheSize ?? DEFAULT_SELECTOR_CACHE_SIZE);
    }

    /**
     * Compile a template and register it under `name`. Errors are thrown as
     * ReflowCompileError. If a template with the same name is already
     * registered, throws — call `clear(name)` first to replace. Async because
     * it drives HTMLRewriter, whose pipeline is asynchronous.
     *
     * @param {string} name
     * @param {string} html
     * @returns {Promise<void>}
     */
    async compile(name, html) {
        if (typeof name !== 'string' || name === '') {
            throw new ReflowCompileError(`compile: name must be a non-empty string`);
        }
        if (typeof html !== 'string') {
            throw new ReflowCompileError(`compile: html must be a string`, { templateName: name });
        }
        if (this._templates.has(name)) {
            throw new ReflowCompileError(
                `template "${name}" already exists; call clear("${name}") before recompiling`,
                { templateName: name }
            );
        }
        const compiled = await compileTemplate({
            name,
            html,
            prefix: this._prefix,
            helperNames: this._helperNames,
        });
        this._templates.set(name, compiled);
    }

    /**
     * Compile a template loaded from a file path via `config.loader`.
     *
     * @param {string} name
     * @param {string} pathname
     * @returns {Promise<void>}
     */
    async compileFile(name, pathname) {
        if (!this._loader) {
            throw new ReflowError(`compileFile: loader is required; provide config.loader in Reflow constructor`);
        }
        const html = await this._loader(pathname);
        return this.compile(name, html);
    }

    /**
     * Render a registered template with the given data as globals ($).
     * When `selector` is provided, only the single element matched by the
     * CSS selector is rendered and its outer HTML is returned; matching
     * zero or more than one element raises ReflowSelectorError. Selector
     * strings are parsed once and memoized in the per-instance LRU cache
     * (see `selectorCacheSize`); a pre-compiled selector produced by
     * `Reflow.compileSelector` skips the cache entirely.
     *
     * @param {string} name
     * @param {object} [data]
     * @param {string | import('./selector/parse.js').CompiledSelector} [selector]
     * @returns {string}
     */
    render(name, data = {}, selector) {
        const compiled = this._templates.get(name);
        if (!compiled) {
            throw new ReflowRuntimeError(
                `template not found: "${name}"`,
                { templateName: name, reason: 'not_found', requested: name }
            );
        }
        if (selector !== undefined) {
            const resolved = this._selectorCache.resolve(selector);
            return renderFragment({
                name,
                compiled,
                data,
                helpers: this._helpers,
                templates: this._templates,
                maxIncludeDepth: this._maxIncludeDepth,
                selector: resolved,
            });
        }
        return renderCompiled({
            name,
            compiled,
            data,
            helpers: this._helpers,
            templates: this._templates,
            maxIncludeDepth: this._maxIncludeDepth,
        });
    }

    /**
     * Remove one or all templates from the cache. Returns the list of names
     * that were actually removed — `[name]` / `[]` when a name is given, or
     * every registered name when omitted. Useful for hot-reload lifecycle.
     *
     * @param {string} [name]
     * @returns {string[]}
     */
    clear(name) {
        if (name === undefined) {
            const removed = Array.from(this._templates.keys());
            this._templates.clear();
            return removed;
        }
        if (this._templates.delete(name)) return [name];
        return [];
    }

    /**
     * List all currently registered template names.
     * @returns {string[]}
     */
    templates() {
        return Array.from(this._templates.keys());
    }

    /**
     * Parse a CSS selector source into a CompiledSelector. Static — the
     * returned object is safe to share across instances and renders and has
     * no side effects (no cache mutation).
     *
     * @param {string} source
     * @returns {import('./selector/parse.js').CompiledSelector}
     */
    static compileSelector(source) {
        return parseSelector(source);
    }

    /**
     * One-shot render with no caching: compile the HTML, render once, discard.
     * Suitable for CLIs, tests, or one-off generation. Do not use on a hot
     * production path — use an instance and compile once instead.
     *
     * @param {string} html
     * @param {object} [data]
     * @param {Config & { selector?: string | import('./selector/parse.js').CompiledSelector }} [config]
     * @returns {Promise<string>}
     */
    static async render(html, data = {}, config = {}) {
        const { selector, ...rest } = config;
        const reflow = new Reflow(rest);
        const name = '<inline>';
        await reflow.compile(name, html);
        return reflow.render(name, data, selector);
    }

    /**
     * One-shot render from a file path without any caching.
     *
     * @param {string} pathname
     * @param {object} [data]
     * @param {Config & { selector?: string | import('./selector/parse.js').CompiledSelector }} [config]
     * @returns {Promise<string>}
     */
    static async renderFile(pathname, data = {}, config = {}) {
        const { selector, ...rest } = config;
        const reflow = new Reflow(rest);
        const name = '<inline>';
        await reflow.compileFile(name, pathname);
        return reflow.render(name, data, selector);
    }
}
