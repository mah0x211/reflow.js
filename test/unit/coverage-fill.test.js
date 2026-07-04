import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../src/expr/parse.js';
import { evaluate } from '../../src/expr/evaluate.js';
import { createEnv, pushFrame } from '../../src/scope.js';
import { Reflow } from '../../src/index.js';

const evalIn = (src, env, helpers = {}) => evaluate(parseExpression(src), env, helpers);

test('<= evaluates true and false branches', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: 5, b: 5, c: 6 });
  assert.equal(evalIn('.a <= .b', env), true);
  assert.equal(evalIn('.c <= .a', env), false);
});

test('>= evaluates true and false branches', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: 5, b: 5, c: 4 });
  assert.equal(evalIn('.a >= .b', env), true);
  assert.equal(evalIn('.c >= .a', env), false);
});

test('|| returns left when truthy', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { a: 'x', b: 'y' });
  assert.equal(evalIn('.a || .b', env), 'x');
});

test('ternary false branch', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { active: false });
  assert.equal(evalIn('.active ? "on" : "off"', env), 'off');
});

test('parser: expect fails for missing closing paren', () => {
  assert.throws(() => parseExpression('(.a'), /expected/);
});

test('parser: !=  at start of unary triggers guard path', () => {
  // !=5 has no LHS — parser should reject cleanly
  assert.throws(() => parseExpression('!=5'), /unexpected/);
});

test('parser: expect fails for ternary missing colon', () => {
  assert.throws(() => parseExpression('.a ? .b .c'), /expected/);
});

test('parser: number literal negative exponent', () => {
  const env = createEnv({});
  assert.equal(evalIn('1.5e-1', env), 0.15);
});

test('x-match with nocase branch fires when no case matches', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-match="$.v"><p x-case="\'a\'">A</p><p x-nocase>D</p></div>');
  assert.equal(r.render('t', { v: 'zzz' }), '<div><p>D</p></div>');
});

test('include-not-found emits requested and reason', async () => {
  const r = new Reflow();
  await r.compile('t', '<section x-include="$.name"></section>');
  try {
    r.render('t', { name: 'not-there' });
    assert.fail();
  } catch (err) {
    assert.equal(err.reason, 'not_found');
    assert.equal(err.requested, 'not-there');
  }
});

test('static Reflow.renderFile without loader fails', async () => {
  await assert.rejects(
    () => Reflow.renderFile('some/path', {}),
    /loader is required/
  );
});

test('parser: postfix breaks on . not followed by identifier', () => {
  // ".a." with trailing '.' — postfix scan should stop at the second '.'
  // and parseExpression should error on the trailing content.
  assert.throws(() => parseExpression('.a.'), /unexpected/);
});
