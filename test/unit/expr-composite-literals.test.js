import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../src/expr/parse.js';
import { evaluate, collectHelperNames } from '../../src/expr/evaluate.js';
import { createEnv, pushFrame } from '../../src/scope.js';

function evalIn(src, data, helpers = {}) {
  const env = createEnv(data);
  return evaluate(parseExpression(src), env, helpers);
}

test('object literal with identifier / string / number keys', () => {
  const got = evalIn(`{ a: 1, "b": 'x', 3: true }`, {});
  assert.deepEqual(got, { a: 1, b: 'x', 3: true });
});

test('object literal is empty when body is empty', () => {
  assert.deepEqual(evalIn(`{}`, {}), {});
  assert.deepEqual(evalIn(`{ }`, {}), {});
});

test('object literal accepts trailing comma', () => {
  assert.deepEqual(evalIn(`{ a: 1, b: 2, }`, {}), { a: 1, b: 2 });
});

test('object literal computed key from scope reference', () => {
  const env = createEnv({ k: 'dyn' });
  const got = evaluate(parseExpression(`{ [$.k]: 'val' }`), env, {});
  assert.deepEqual(got, { dyn: 'val' });
});

test('object literal computed key from string / number literal', () => {
  assert.deepEqual(evalIn(`{ ['x']: 1 }`, {}), { x: 1 });
  assert.deepEqual(evalIn(`{ [42]: 1 }`, {}), { 42: 1 });
});

test('object literal computed key accepts member chain and optional chaining', () => {
  const env = createEnv({ meta: { key: 'k' } });
  assert.deepEqual(
    evaluate(parseExpression(`{ [$.meta.key]: 'v' }`), env, {}),
    { k: 'v' }
  );
  const env2 = createEnv({ missing: null });
  assert.throws(
    () => evaluate(parseExpression(`{ [$.missing?.key]: 'v' }`), env2, {}),
    /computed key must evaluate to a string or number, got undefined/
  );
});

test('computed key rejects helper calls at parse time', () => {
  assert.throws(
    () => parseExpression(`{ [upper('x')]: 1 }`),
    /computed object key must be a string, number, or scope reference/
  );
});

test('computed key rejects operators at parse time', () => {
  assert.throws(
    () => parseExpression(`{ [true && 'x']: 1 }`),
    /computed object key must be a string, number, or scope reference/
  );
});

test('computed key rejects nested object/array at parse time', () => {
  assert.throws(() => parseExpression(`{ [{a:1}]: 1 }`));
  assert.throws(() => parseExpression(`{ [[1,2]]: 1 }`));
});

test('computed key: bare $ without dot is rejected', () => {
  assert.throws(
    () => parseExpression(`{ [$]: 1 }`),
    /"\$" must be followed by ".<identifier>"/
  );
});

test('computed key: bare @ without name is rejected', () => {
  assert.throws(
    () => parseExpression(`{ [@]: 1 }`),
    /"@" must be followed by an identifier/
  );
});

test('computed key: @name reference resolves', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { k: 'from-at' });
  assert.deepEqual(
    evaluate(parseExpression(`{ [@k]: 1 }`), env, {}),
    { 'from-at': 1 }
  );
});

test('computed key: .name reference resolves', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { k: 'from-dot' });
  assert.deepEqual(
    evaluate(parseExpression(`{ [.k]: 1 }`), env, {}),
    { 'from-dot': 1 }
  );
});

test('computed key: bare . without name is rejected', () => {
  assert.throws(
    () => parseExpression(`{ [.9]: 1 }`),
    /"\." must be followed by an identifier/
  );
});

test('computed key: numeric literal', () => {
  assert.deepEqual(evalIn(`{ [7]: 'x' }`, {}), { 7: 'x' });
});

test('computed key: negative numeric literal', () => {
  assert.deepEqual(evalIn(`{ [-1]: 'x' }`, {}), { '-1': 'x' });
});

test('computed key rejects unbracketed expression', () => {
  assert.throws(() => parseExpression(`{ .k: 1 }`));
});

test('computed key throws at runtime when result is not string or number', () => {
  const env = createEnv({ obj: { nested: true } });
  const ast = parseExpression(`{ [$.obj]: 'v' }`);
  assert.throws(
    () => evaluate(ast, env, {}),
    /computed key must evaluate to a string or number, got object/
  );
});

test('computed key throws for null / undefined / boolean / array', () => {
  const env = createEnv({ a: null, b: undefined, c: true, d: [1, 2] });
  assert.throws(() => evaluate(parseExpression(`{ [$.a]: 1 }`), env, {}), /null/);
  assert.throws(() => evaluate(parseExpression(`{ [$.b]: 1 }`), env, {}), /undefined/);
  assert.throws(() => evaluate(parseExpression(`{ [$.c]: 1 }`), env, {}), /boolean/);
  assert.throws(() => evaluate(parseExpression(`{ [$.d]: 1 }`), env, {}), /array/);
});

test('object literal duplicate keys — last write wins', () => {
  assert.deepEqual(evalIn(`{ a: 1, a: 2 }`, {}), { a: 2 });
  const env = createEnv({ k: 'a' });
  assert.deepEqual(
    evaluate(parseExpression(`{ a: 1, [$.k]: 2 }`), env, {}),
    { a: 2 }
  );
});

test('object literal supports nested literals and helper values', () => {
  const helpers = { upper: (s) => String(s).toUpperCase() };
  const env = createEnv({ name: 'alice' });
  assert.deepEqual(
    evaluate(parseExpression(`{ user: { name: upper($.name) }, tags: ['a', 'b'] }`), env, helpers),
    { user: { name: 'ALICE' }, tags: ['a', 'b'] }
  );
});

test('array literal with mixed expression items', () => {
  const env = createEnv({ n: 5 });
  pushFrame(env, 'data', { extra: 'x' });
  assert.deepEqual(
    evaluate(parseExpression(`[ 1, $.n, .extra, true, null ]`), env, {}),
    [1, 5, 'x', true, null]
  );
});

test('array literal is empty when body is empty and accepts trailing comma', () => {
  assert.deepEqual(evalIn(`[]`, {}), []);
  assert.deepEqual(evalIn(`[ ]`, {}), []);
  assert.deepEqual(evalIn(`[ 1, 2, ]`, {}), [1, 2]);
});

test('array literal nested inside object literal', () => {
  assert.deepEqual(
    evalIn(`{ nums: [1, 2, [3, 4]] }`, {}),
    { nums: [1, 2, [3, 4]] }
  );
});

test('object literal usable as expression in ternary', () => {
  const env = createEnv({ mode: 'a' });
  const got = evaluate(
    parseExpression(`$.mode == 'a' ? { kind: 'A' } : { kind: 'B' }`),
    env,
    {}
  );
  assert.deepEqual(got, { kind: 'A' });
});

test('collectHelperNames descends into object and array literals', () => {
  const ast = parseExpression(`{ x: upper($.a), y: [lower($.b), foo()] }`);
  const names = Array.from(collectHelperNames(ast)).sort();
  assert.deepEqual(names, ['foo', 'lower', 'upper']);
});

test('unterminated object/array literals are rejected', () => {
  assert.throws(() => parseExpression(`{ a: 1`));
  assert.throws(() => parseExpression(`[ 1, 2`));
});

test('missing colon after key is rejected', () => {
  assert.throws(() => parseExpression(`{ a 1 }`));
});

test('missing key before colon is rejected', () => {
  assert.throws(() => parseExpression(`{ : 1 }`));
});
