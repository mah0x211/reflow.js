/**
 * @file Bounded LRU cache for parsed selectors.
 *
 * Sits between callers that pass raw selector strings to `render(...)` and
 * the parser. Only successfully parsed selectors are inserted; strings that
 * fail parsing throw and are never cached, so an attacker spamming invalid
 * selectors cannot bloat memory. The insertion order is maintained via
 * Map iteration order and evicted from the oldest end when the size limit is
 * reached; a cache size of 0 disables the cache entirely.
 */

import { parseSelector, isCompiledSelector } from './parse.js';

/**
 * @typedef {import('./parse.js').CompiledSelector} CompiledSelector
 */

export class SelectorCache {
    /**
     * @param {number} [maxSize]
     */
    constructor(maxSize = 128) {
        if (!Number.isInteger(maxSize) || maxSize < 0) {
            throw new TypeError('selectorCacheSize must be a non-negative integer');
        }
        this._max = maxSize;
        /** @type {Map<string, CompiledSelector>} */
        this._map = new Map();
    }

    /** Number of live entries. */
    get size() { return this._map.size; }

    /** Maximum retained entries. */
    get maxSize() { return this._max; }

    /**
     * Look up an existing entry without changing its recency. Returns
     * undefined when absent.
     * @param {string} source
     * @returns {CompiledSelector | undefined}
     */
    peek(source) {
        return this._map.get(source);
    }

    /**
     * Return the compiled selector for `input`. If `input` is already a
     * compiled selector, it is returned as-is (no caching side effect). If
     * it is a string, the cache is consulted; on a miss the string is parsed
     * (which may throw ReflowSelectorError) and — only on parse success —
     * inserted into the cache before being returned.
     *
     * @param {string | CompiledSelector} input
     * @returns {CompiledSelector}
     */
    resolve(input) {
        if (isCompiledSelector(input)) return /** @type {CompiledSelector} */(input);
        if (typeof input !== 'string') {
            // Delegate to parseSelector so the caller sees the standard
            // ReflowSelectorError shape (which validates its input type too).
            return parseSelector(/** @type {any} */(input));
        }
        if (this._max === 0) return parseSelector(input);

        const hit = this._map.get(input);
        if (hit) {
            // Refresh recency: re-insert to move to the end of the iteration order.
            this._map.delete(input);
            this._map.set(input, hit);
            return hit;
        }
        // Parse first; only cache successful results.
        const compiled = parseSelector(input);
        this._map.set(input, compiled);
        if (this._map.size > this._max) {
            // Evict the oldest entry (Map iteration order is insertion order).
            const oldest = this._map.keys().next().value;
            this._map.delete(oldest);
        }
        return compiled;
    }

    /** Remove all entries. */
    clear() {
        this._map.clear();
    }
}
