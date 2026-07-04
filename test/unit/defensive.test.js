import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from '../../src/scope.js';
import {
  ReflowError,
  ReflowCompileError,
  ReflowRuntimeError,
  ReflowIncludeError,
} from '../../src/index.js';
import { collectHelperNames } from '../../src/expr/evaluate.js';
import { parseExpression } from '../../src/expr/parse.js';

test('createEnv with undefined globals defaults to {}', () => {
  const env = createEnv(undefined);
  assert.deepEqual(env.globals, {});
});

test('createEnv with null globals defaults to {}', () => {
  const env = createEnv(null);
  assert.deepEqual(env.globals, {});
});

test('createEnv with provided globals preserves them', () => {
  const env = createEnv({ a: 1 });
  assert.deepEqual(env.globals, { a: 1 });
});

test('ReflowError meta does not overwrite reserved properties', () => {
  const err = new ReflowError('m', { name: 'ShouldNotWin', message: 'nope' });
  assert.equal(err.name, 'ReflowError');
  assert.equal(err.message, 'm');
});

test('ReflowError meta cause is exposed', () => {
  const orig = new Error('root');
  const err = new ReflowError('m', { cause: orig });
  assert.equal(err.cause, orig);
});

test('all error classes have correct names', () => {
  assert.equal(new ReflowError('x').name, 'ReflowError');
  assert.equal(new ReflowCompileError('x').name, 'ReflowCompileError');
  assert.equal(new ReflowRuntimeError('x').name, 'ReflowRuntimeError');
  assert.equal(new ReflowIncludeError('x').name, 'ReflowIncludeError');
});

test('collectHelperNames walks unary operand', () => {
  const ast = parseExpression('!foo(.x)');
  const names = Array.from(collectHelperNames(ast));
  assert.deepEqual(names, ['foo']);
});

test('collectHelperNames on non-object returns empty set', () => {
  const s = collectHelperNames(null);
  assert.equal(s.size, 0);
});
