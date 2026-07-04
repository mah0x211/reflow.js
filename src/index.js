/**
 * @file Public entry point for reflow (Node.js).
 *
 * Installs the html-rewriter-wasm adapter into compile.js as a module
 * side-effect. Cloudflare Workers resolve `src/index.workers.js` via the
 * `workerd` export condition instead, which wires the native adapter and
 * excludes html-rewriter-wasm from the bundle.
 */

import { setRewriter } from './compile.js';
import { runRewriter } from './htmlrewriter.node.js';

// Module side-effect: install the Node adapter before any compile call.
setRewriter(runRewriter);

export { Reflow } from './reflow.js';
export {
    ReflowError,
    ReflowCompileError,
    ReflowRuntimeError,
    ReflowIncludeError,
} from './errors.js';
