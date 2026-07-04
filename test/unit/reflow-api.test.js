import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow, ReflowCompileError, ReflowRuntimeError } from '../../src/index.js';

test('duplicate compile throws ReflowCompileError', async () => {
  const r = new Reflow();
  await r.compile('t', '<p>hi</p>');
  await assert.rejects(
    () => r.compile('t', '<p>bye</p>'),
    (err) => err instanceof ReflowCompileError && /already exists/.test(err.message)
  );
});

test('clear(name) removes only that template', async () => {
  const r = new Reflow();
  await r.compile('a', '<p>A</p>');
  await r.compile('b', '<p>B</p>');
  const removed = r.clear('a');
  assert.deepEqual(removed, ['a']);
  assert.deepEqual(r.templates().sort(), ['b']);
});

test('clear(nonexistent) returns []', async () => {
  const r = new Reflow();
  await r.compile('a', '<p>A</p>');
  assert.deepEqual(r.clear('nope'), []);
  assert.deepEqual(r.templates(), ['a']);
});

test('clear() with no args removes all', async () => {
  const r = new Reflow();
  await r.compile('a', '<p>A</p>');
  await r.compile('b', '<p>B</p>');
  const removed = r.clear().sort();
  assert.deepEqual(removed, ['a', 'b']);
  assert.deepEqual(r.templates(), []);
});

test('re-compile after clear is allowed', async () => {
  const r = new Reflow();
  await r.compile('t', '<p>v1</p>');
  r.clear('t');
  await r.compile('t', '<p>v2</p>');
  assert.equal(r.render('t'), '<p>v2</p>');
});

test('render nonexistent template throws ReflowRuntimeError', () => {
  const r = new Reflow();
  assert.throws(
    () => r.render('missing'),
    (err) => err instanceof ReflowRuntimeError && err.reason === 'not_found'
  );
});

test('compileFile without loader throws', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compileFile('t', '/some/path'),
    (err) => /loader is required/.test(err.message)
  );
});

test('compileFile uses provided loader', async () => {
  const r = new Reflow({
    loader: async (p) => `<p>path=${p}</p>`,
  });
  await r.compileFile('t', 'x/y');
  assert.equal(r.render('t'), '<p>path=x/y</p>');
});

test('static Reflow.render one-shot', async () => {
  const html = await Reflow.render('<p x-text="$.x"></p>', { x: 'hello' });
  assert.equal(html, '<p>hello</p>');
});

test('helpers passed to constructor are available', async () => {
  const r = new Reflow({ helpers: { upper: (s) => String(s).toUpperCase() } });
  await r.compile('t', '<p x-text="upper($.n)"></p>');
  assert.equal(r.render('t', { n: 'alice' }), '<p>ALICE</p>');
});

test('templates() returns registered names', async () => {
  const r = new Reflow();
  await r.compile('a', '<p>A</p>');
  await r.compile('b', '<p>B</p>');
  assert.deepEqual(r.templates().sort(), ['a', 'b']);
});

test('custom prefix works', async () => {
  const r = new Reflow({ prefix: 'r-' });
  await r.compile('t', '<p r-text="$.x"></p>');
  assert.equal(r.render('t', { x: 'hi' }), '<p>hi</p>');
});

test('custom prefix rejects default x-*', async () => {
  const r = new Reflow({ prefix: 'r-' });
  // x-if is not a directive under 'r-' prefix — but it also doesn't start with 'r-',
  // so it's treated as a regular attribute (passthrough).
  await r.compile('t', '<p x-if="$.a">hi</p>');
  assert.equal(r.render('t', { a: true }), '<p x-if="$.a">hi</p>');
});
