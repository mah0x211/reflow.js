/**
 * @file Scope stack and reference resolution.
 *
 * The environment is a stack of frames; each frame holds top-level names
 * ('data' frames from x-data, 'loop' frames from x-for / x-each). References
 * resolve through one of three symbols and no un-prefixed magic variables
 * exist: $ (globals), @name (a named x-data scope), and .name (the nearest
 * lexical binding). Unresolved references are loose — they return undefined
 * instead of throwing. The per-symbol rules live on resolveDollar /
 * resolveDot / resolveAt below; @ and . agree unless a loop variable shadows
 * a x-data name.
 */

/**
 * Frame kinds:
 *  - 'data'  : from x-data, top-level keys are named scopes
 *  - 'loop'  : from x-for / x-each, top-level keys are loop variables
 *
 * @typedef {{ kind: 'data' | 'loop', vars: Record<string, unknown> }} Frame
 * @typedef {{ frames: Frame[], globals: Record<string, unknown> }} Env
 */

/**
 * Create a fresh environment. `globals` becomes the $ value (the `data`
 * passed to render(name, data)); it is unaffected by lexical scope and is the
 * only context carried into included templates.
 * @param {Record<string, unknown>} globals
 * @returns {Env}
 */
export function createEnv(globals) {
    return { frames: [], globals: globals ?? {} };
}

/**
 * Push a new frame onto the environment stack. Returns a token to pop with.
 * @param {Env} env
 * @param {'data' | 'loop'} kind
 * @param {Record<string, unknown>} vars
 */
export function pushFrame(env, kind, vars) {
    env.frames.push({ kind, vars });
}

/**
 * Pop the top frame from the environment stack.
 * @param {Env} env
 */
export function popFrame(env) {
    env.frames.pop();
}

/**
 * Resolve the leading identifier of a `.<name>...` reference: scan ALL frames
 * (data + loop) from innermost outward and return the value of the top-level
 * key, or undefined if none has it. Because loop frames are included, a loop
 * variable shadows a same-named x-data scope — use @name (resolveAt) to reach
 * past the loop variable. Returning undefined (rather than throwing) is the
 * loose behavior; accessing a property of undefined without `?.` raises a
 * TypeError at expression-evaluation time.
 * @param {Env} env
 * @param {string} name
 * @returns {unknown}
 */
export function resolveDot(env, name) {
    for (let i = env.frames.length - 1; i >= 0; i--) {
        const frame = env.frames[i];
        if (Object.prototype.hasOwnProperty.call(frame.vars, name)) {
            return frame.vars[name];
        }
    }
    return undefined;
}

/**
 * Resolve the leading identifier of a `@<name>...` reference: scan ONLY data
 * (x-data) frames from innermost outward, skipping loop frames, and return the
 * value, or undefined if not found. Use @name to reach a x-data scope that a
 * same-named loop variable would otherwise shadow (resolveDot would return the
 * loop variable instead).
 * @param {Env} env
 * @param {string} name
 * @returns {unknown}
 */
export function resolveAt(env, name) {
    for (let i = env.frames.length - 1; i >= 0; i--) {
        const frame = env.frames[i];
        if (frame.kind !== 'data') continue;
        if (Object.prototype.hasOwnProperty.call(frame.vars, name)) {
            return frame.vars[name];
        }
    }
    return undefined;
}

/**
 * Resolve `$.<...>` — always returns the globals object (the render `data`).
 * $ is unaffected by lexical scope and is carried into included templates
 * unchanged.
 * @param {Env} env
 * @returns {unknown}
 */
export function resolveDollar(env) {
    return env.globals;
}
