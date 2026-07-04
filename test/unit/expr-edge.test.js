import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../src/expr/parse.js';
import { evaluate } from '../../src/expr/evaluate.js';
import { createEnv, pushFrame } from '../../src/scope.js';

test('parses all string escape sequences', () => {
  const env = createEnv({});
  assert.equal(evaluate(parseExpression("'\\n'"), env, {}), '\n');
  assert.equal(evaluate(parseExpression("'\\t'"), env, {}), '\t');
  assert.equal(evaluate(parseExpression("'\\r'"), env, {}), '\r');
  assert.equal(evaluate(parseExpression("'\\\\'"), env, {}), '\\');
  assert.equal(evaluate(parseExpression("'\\''"), env, {}), "'");
  assert.equal(evaluate(parseExpression("'\\\"'"), env, {}), '"');
  assert.equal(evaluate(parseExpression("'\\`'"), env, {}), '`');
  assert.equal(evaluate(parseExpression("'\\0'"), env, {}), '\0');
});

test('rejects invalid escape sequences', () => {
  assert.throws(() => parseExpression("'\\z'"), /invalid escape/);
});

test('rejects unterminated strings', () => {
  assert.throws(() => parseExpression("'unterminated"), /unterminated/);
});

test('parses numbers with exponent', () => {
  const env = createEnv({});
  assert.equal(evaluate(parseExpression('1e3'), env, {}), 1000);
  assert.equal(evaluate(parseExpression('1E3'), env, {}), 1000);
  assert.equal(evaluate(parseExpression('1e+3'), env, {}), 1000);
  assert.equal(evaluate(parseExpression('1e-3'), env, {}), 0.001);
  assert.equal(evaluate(parseExpression('1.5e2'), env, {}), 150);
});

test('rejects unexpected end of expression', () => {
  assert.throws(() => parseExpression(''), /unexpected end/);
  assert.throws(() => parseExpression('  '), /unexpected end/);
});

test('rejects unexpected characters', () => {
  assert.throws(() => parseExpression('~'), /unexpected/);
  assert.throws(() => parseExpression('#'), /unexpected/);
});

test('$ must be followed by dot', () => {
  assert.throws(() => parseExpression('$'), /must be followed/);
  assert.throws(() => parseExpression('$foo'), /must be followed/);
});

test('@ must be followed by identifier', () => {
  assert.throws(() => parseExpression('@'), /must be followed/);
  assert.throws(() => parseExpression('@.foo'), /must be followed/);
});

test('. must be followed by identifier', () => {
  assert.throws(() => parseExpression('.'), /must be followed/);
  assert.throws(() => parseExpression('.9'), /must be followed/);
});

test('?. must be followed by identifier', () => {
  assert.throws(() => parseExpression('.a?.'), /expected identifier after/);
});

test('rejects trailing content after expression', () => {
  assert.throws(() => parseExpression("'hi' xyz"), /unexpected/);
});

test('parses parenthesized expressions', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: 1, b: 2 });
  assert.equal(evaluate(parseExpression('(.a == 1) && (.b == 2)'), env, {}), true);
});

test('helper call with zero args', () => {
  const env = createEnv({});
  const helpers = { now: () => 'now-value' };
  assert.equal(evaluate(parseExpression('now()'), env, helpers), 'now-value');
});

test('helper call with trailing comma tolerance behavior', () => {
  // No trailing comma allowed
  assert.throws(() => parseExpression('foo(a,)'));
});

test('nested member access', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: { b: { c: { d: 'deep' } } } });
  assert.equal(evaluate(parseExpression('.a.b.c.d'), env, {}), 'deep');
});

test('mixed optional and non-optional chain', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: { b: null } });
  assert.equal(evaluate(parseExpression('.a.b?.c'), env, {}), undefined);
});

test('evaluate handles && short-circuit returning left value', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { falsy: 0, truthy: 5 });
  assert.equal(evaluate(parseExpression('.falsy && .truthy'), env, {}), 0);
  assert.equal(evaluate(parseExpression('.truthy && .falsy'), env, {}), 0);
});

test('evaluate handles || returning right value when left falsy', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: '', b: 'x' });
  assert.equal(evaluate(parseExpression('.a || .b'), env, {}), 'x');
});
