/**
 * @file HTMLRewriter adapter for Node.js — backed by html-rewriter-wasm.
 *
 * The wasm build is pure CommonJS, but Node's cjs-module-lexer exposes
 * `HTMLRewriter` as a named ESM export, and WASM initialisation runs
 * synchronously at module load — so a static import works without an async
 * init wrapper. This file is reached only via the Node/default package entry;
 * the Workers entry never imports it, so html-rewriter-wasm is excluded from
 * Workers bundles.
 *
 * The adapter exposes a single async `runRewriter(html, handlers)` that
 * drives parsing and lets registered handlers run their side effects.
 */

import { HTMLRewriter } from 'html-rewriter-wasm';

/**
 * @typedef {{
 *   element?: (el: any) => void,
 *   text?: (t: any) => void,
 *   comments?: (c: any) => void,
 * }} SelectorHandlers
 */

/**
 * Run HTMLRewriter on the given html string, invoking the provided
 * handlers. Output bytes are discarded — this adapter is used for parsing.
 *
 * @param {string} html
 * @param {Record<string, SelectorHandlers>} handlers
 * @returns {Promise<void>}
 */
export async function runRewriter(html, handlers) {
    const rw = new HTMLRewriter(() => {
        // Discard output chunks.
    });
    for (const [selector, h] of Object.entries(handlers)) rw.on(selector, h);
    try {
        await rw.write(new TextEncoder().encode(html));
        await rw.end();
    } finally {
        rw.free();
    }
}
