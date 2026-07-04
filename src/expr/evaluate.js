/**
 * @file Expression AST interpreter.
 *
 * Evaluates an expression AST produced by parseExpression. The per-node
 * semantics live on `evaluate` below.
 */

import { resolveDot, resolveAt, resolveDollar } from '../scope.js';

/**
 * Evaluate an expression AST against an environment + helper registry.
 *
 * Per-node semantics (per the project's expression language):
 *   literal         -> its value (string / number / true / false / null).
 *   $  @name  .name -> scope references, resolved by the scope module.
 *   a.b   a?.b      -> property access; `?.` short-circuits to undefined when
 *                      a is null/undefined.
 *   !a              -> logical NOT.
 *   == !=           -> strict equality (no coercion; like JS === / !==).
 *   < > <= >=       -> relational, JS semantics (no throw on mismatched types).
 *   a && b          -> if a is truthy, evaluate and return b; else return a.
 *   a || b          -> if a is truthy, return a; else evaluate and return b.
 *   a ?? b          -> if a is null/undefined, evaluate and return b; else a
 *                      (empty string / 0 / false are NOT nullish and stay).
 *   c ? t : e       -> JS truthiness of c selects the branch.
 *   name(args)      -> call a REGISTERED helper: helpers[name].apply(null,
 *                      args.map(evaluate)). Arity is not checked.
 *
 * Disallowed constructs (arithmetic, concatenation, method calls, non-scalar
 * literals) never reach the interpreter — they are rejected by the parser.
 *
 * @param {object} node   AST node produced by parseExpression
 * @param {import('../scope.js').Env} env
 * @param {Record<string, Function>} helpers
 * @returns {unknown}
 */
export function evaluate(node, env, helpers) {
    switch (node.type) {
        case 'literal':
            return node.value;

        case 'dollar':
            return resolveDollar(env);

        case 'at':
            return resolveAt(env, node.name);

        case 'dot':
            return resolveDot(env, node.name);

        case 'member': {
            const obj = evaluate(node.object, env, helpers);
            if (node.optional && (obj === null || obj === undefined)) return undefined;
            return obj[node.property];
        }

        case 'unary':
            // Only '!' is defined
            return !evaluate(node.arg, env, helpers);

        case 'binary': {
            switch (node.op) {
                case '==': return evaluate(node.left, env, helpers) === evaluate(node.right, env, helpers);
                case '!=': return evaluate(node.left, env, helpers) !== evaluate(node.right, env, helpers);
                case '<': return evaluate(node.left, env, helpers) < evaluate(node.right, env, helpers);
                case '>': return evaluate(node.left, env, helpers) > evaluate(node.right, env, helpers);
                case '<=': return evaluate(node.left, env, helpers) <= evaluate(node.right, env, helpers);
                case '>=': return evaluate(node.left, env, helpers) >= evaluate(node.right, env, helpers);
                case '&&': {
                    const l = evaluate(node.left, env, helpers);
                    return l ? evaluate(node.right, env, helpers) : l;
                }
                case '||': {
                    const l = evaluate(node.left, env, helpers);
                    return l ? l : evaluate(node.right, env, helpers);
                }
                case '??': {
                    const l = evaluate(node.left, env, helpers);
                    return (l === null || l === undefined) ? evaluate(node.right, env, helpers) : l;
                }
                /* c8 ignore start */
                default:
                    throw new Error(`unknown binary operator: ${node.op}`);
                /* c8 ignore stop */
            }
        }

        case 'ternary':
            return evaluate(node.test, env, helpers)
                ? evaluate(node.consequent, env, helpers)
                : evaluate(node.alternate, env, helpers);

        case 'call': {
            const fn = helpers[node.callee];
            /* c8 ignore start */
            if (typeof fn !== 'function') {
                // Compile-time check should have caught this; guard for defense.
                throw new Error(`helper "${node.callee}" is not registered`);
            }
            /* c8 ignore stop */
            const args = node.args.map((a) => evaluate(a, env, helpers));
            return fn.apply(null, args);
        }

        /* c8 ignore start */
        default:
            throw new Error(`unknown expression node type: ${node.type}`);
        /* c8 ignore stop */
    }
}

/**
 * Collect the set of helper identifiers referenced by an expression AST.
 * Used at compile time to detect references to unregistered helpers.
 *
 * @param {object} node
 * @param {Set<string>} [out]
 * @returns {Set<string>}
 */
export function collectHelperNames(node, out = new Set()) {
    if (!node || typeof node !== 'object') return out;
    switch (node.type) {
        case 'call':
            out.add(node.callee);
            for (const arg of node.args) collectHelperNames(arg, out);
            break;
        case 'member':
            collectHelperNames(node.object, out);
            break;
        case 'unary':
            collectHelperNames(node.arg, out);
            break;
        case 'binary':
            collectHelperNames(node.left, out);
            collectHelperNames(node.right, out);
            break;
        case 'ternary':
            collectHelperNames(node.test, out);
            collectHelperNames(node.consequent, out);
            collectHelperNames(node.alternate, out);
            break;
        default:
            break;
    }
    return out;
}
