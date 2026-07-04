/**
 * @file HTMLRewriter adapter for Cloudflare Workers — uses the native
 * `globalThis.HTMLRewriter`. Never imports html-rewriter-wasm, so bundlers
 * selecting this entry (via the `workerd` export condition) exclude the wasm
 * dependency entirely.
 *
 * The adapter exposes a single async `runRewriter(html, handlers)` that
 * drives parsing and lets registered handlers run their side effects.
 */

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
    const rw = new globalThis.HTMLRewriter();
    for (const [selector, h] of Object.entries(handlers)) rw.on(selector, h);
    const resp = rw.transform(new Response(html));
    // Drain the response so the pipeline runs to completion.
    await resp.arrayBuffer();
}
