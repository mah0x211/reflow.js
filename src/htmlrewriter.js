/**
 * @file HTMLRewriter environment adapter.
 *
 * On Cloudflare Workers `globalThis.HTMLRewriter` is available natively.
 * On Node.js the same API is provided by `html-rewriter-wasm`.
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
    const NativeHTMLRewriter =
        typeof globalThis.HTMLRewriter === 'function' ? globalThis.HTMLRewriter : null;

    if (NativeHTMLRewriter) {
        const rw = new NativeHTMLRewriter();
        for (const [selector, h] of Object.entries(handlers)) rw.on(selector, h);
        const resp = rw.transform(new Response(html));
        // Drain the response so the pipeline runs to completion.
        await resp.arrayBuffer();
        return;
    }

    const { HTMLRewriter } = await import('html-rewriter-wasm');
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
