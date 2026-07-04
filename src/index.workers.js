/**
 * @file Public entry point for reflow (Cloudflare Workers).
 *
 * Identical public surface to src/index.js, but wires the native
 * globalThis.HTMLRewriter adapter instead of html-rewriter-wasm. Selected via
 * the `workerd` export condition so html-rewriter-wasm is never pulled into
 * the Worker bundle.
 */

import { setRewriter } from './compile.js';
import { runRewriter } from './htmlrewriter.workers.js';

// Module side-effect: install the native Workers adapter before any compile call.
setRewriter(runRewriter);

export { Reflow } from './reflow.js';
export {
    ReflowError,
    ReflowCompileError,
    ReflowRuntimeError,
    ReflowIncludeError,
} from './errors.js';
