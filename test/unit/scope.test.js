import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, pushFrame, popFrame, resolveDot, resolveAt, resolveDollar } from '../../src/scope.js';

test('resolveDollar returns globals', () => {
  const env = createEnv({ a: 1 });
  assert.deepEqual(resolveDollar(env), { a: 1 });
});

test('resolveDot returns undefined when not found', () => {
  const env = createEnv({});
  assert.equal(resolveDot(env, 'missing'), undefined);
});

test('resolveDot searches innermost frame first', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { x: 'outer' });
  pushFrame(env, 'data', { x: 'inner' });
  assert.equal(resolveDot(env, 'x'), 'inner');
});

test('resolveAt skips loop frames', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { name: 'from-data' });
  pushFrame(env, 'loop', { name: 'from-loop' });
  assert.equal(resolveDot(env, 'name'), 'from-loop');
  assert.equal(resolveAt(env, 'name'), 'from-data');
});

test('resolveAt returns undefined when only loop frames have it', () => {
  const env = createEnv({});
  pushFrame(env, 'loop', { onlyLoop: 1 });
  assert.equal(resolveAt(env, 'onlyLoop'), undefined);
  assert.equal(resolveDot(env, 'onlyLoop'), 1);
});

test('popFrame restores previous state', () => {
  const env = createEnv({});
  pushFrame(env, 'data', { x: 1 });
  pushFrame(env, 'data', { x: 2 });
  popFrame(env);
  assert.equal(resolveDot(env, 'x'), 1);
});
