import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../src/expr/parse.js';
import { evaluate, collectHelperNames } from '../../src/expr/evaluate.js';
import { createEnv, pushFrame } from '../../src/scope.js';

function eval1(src, env, helpers = {}) {
  return evaluate(parseExpression(src), env, helpers);
}

test('parses literals', () => {
  const env = createEnv({});
  assert.equal(eval1("'hi'", env), 'hi');
  assert.equal(eval1('"hi"', env), 'hi');
  assert.equal(eval1('42', env), 42);
  assert.equal(eval1('-1', env), -1);
  assert.equal(eval1('3.14', env), 3.14);
  assert.equal(eval1('true', env), true);
  assert.equal(eval1('false', env), false);
  assert.equal(eval1('null', env), null);
});

test('parses scope references', () => {
  const env = createEnv({ user: { name: 'Alice' } });
  pushFrame(env, 'data', { conf: { locale: 'ja' }, item: 5 });
  assert.equal(eval1('$.user.name', env), 'Alice');
  assert.equal(eval1('@conf.locale', env), 'ja');
  assert.equal(eval1('.conf.locale', env), 'ja');
  assert.equal(eval1('.item', env), 5);
});

test('optional chaining short-circuits on null/undefined', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: null, b: { c: 3 } });
  assert.equal(eval1('.a?.foo', env), undefined);
  assert.equal(eval1('.b?.c', env), 3);
  assert.equal(eval1('.missing?.x', env), undefined);
});

test('comparison and logical operators', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { n: 5, s: 'x' });
  assert.equal(eval1('.n == 5', env), true);
  assert.equal(eval1('.n != 5', env), false);
  assert.equal(eval1('.n < 10 && .s == "x"', env), true);
  assert.equal(eval1('.n > 100 || .s == "y"', env), false);
  assert.equal(eval1('!(.n == 5)', env), false);
});

test('ternary', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { active: true });
  assert.equal(eval1('.active ? "on" : "off"', env), 'on');
});

test('null coalescing', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: null, b: 0, c: '' });
  assert.equal(eval1('.a ?? "default"', env), 'default');
  assert.equal(eval1('.b ?? 99', env), 0);
  assert.equal(eval1('.c ?? "x"', env), '');
});

test('helper calls', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { name: 'alice' });
  const helpers = { upper: (s) => String(s).toUpperCase(), concat: (...a) => a.join('') };
  assert.equal(eval1('upper(.name)', env, helpers), 'ALICE');
  assert.equal(eval1('concat("Hello, ", upper(.name), "!")', env, helpers), 'Hello, ALICE!');
});

test('collectHelperNames finds nested calls', () => {
  const ast = parseExpression('upper(lower(.x)) ? foo(.a, .b) : bar()');
  const names = Array.from(collectHelperNames(ast)).sort();
  assert.deepEqual(names, ['bar', 'foo', 'lower', 'upper']);
});

test('rejects arithmetic operators', () => {
  assert.throws(() => parseExpression('1 + 2'));
  assert.throws(() => parseExpression('a - b'));
});

test('rejects method call syntax', () => {
  assert.throws(() => parseExpression('.a.b()'));
});

test('rejects bare identifier without call', () => {
  assert.throws(() => parseExpression('foo'));
});

test('rejects reserved keyword literals only', () => {
  const env = createEnv({});
  assert.equal(eval1('true', env), true);
  assert.equal(eval1('null', env), null);
});
