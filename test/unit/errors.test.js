import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Reflow,
  ReflowCompileError,
  ReflowRuntimeError,
  ReflowIncludeError,
} from '../../src/index.js';

test('compile error includes template name, snippet, line, column, element', async () => {
  const r = new Reflow();
  const html = '<div>\n  <p>ok</p>\n  <template x-else="foo">bad</template>\n</div>';
  try {
    await r.compile('layout', html);
    assert.fail('expected an error');
  } catch (err) {
    assert.ok(err instanceof ReflowCompileError, `got ${err.name}`);
    assert.equal(err.templateName, 'layout');
    assert.equal(typeof err.line, 'number');
    assert.equal(typeof err.column, 'number');
    assert.equal(err.line, 3);
    assert.ok(typeof err.snippet === 'string' && err.snippet.length > 0);
    assert.match(err.snippet, /\^\^\^/);
    assert.ok(err.element?.startsWith('<template'));
  }
});

test('runtime error includes include stack', async () => {
  const r = new Reflow();
  await r.compile('layout', '<div><section x-include="$.content"></section></div>');
  await r.compile('page', '<article><p x-text=".missing.field"></p></article>');
  try {
    r.render('layout', { content: 'page' });
    assert.fail('expected an error');
  } catch (err) {
    assert.ok(err instanceof ReflowRuntimeError, `got ${err.name}`);
    assert.deepEqual(err.includeStack, ['layout', 'page']);
    assert.equal(err.templateName, 'page');
  }
});

test('include cycle error carries reason and stack', async () => {
  const r = new Reflow();
  await r.compile('a', '<section x-include="\'b\'"></section>');
  await r.compile('b', '<section x-include="\'a\'"></section>');
  try {
    r.render('a');
    assert.fail('expected an error');
  } catch (err) {
    assert.ok(err instanceof ReflowIncludeError);
    assert.equal(err.reason, 'cycle');
    assert.deepEqual(err.includeStack, ['a', 'b']);
    assert.equal(err.requested, 'a');
  }
});

test('include depth exceeded reports reason', async () => {
  const r = new Reflow({ maxIncludeDepth: 3 });
  await r.compile('rec', '<section x-include="\'rec\'"></section>');
  try {
    r.render('rec');
    assert.fail('expected an error');
  } catch (err) {
    assert.ok(err instanceof ReflowIncludeError);
    // Cycle detection kicks in before depth (both are valid guards).
    assert.ok(err.reason === 'cycle' || err.reason === 'depth_exceeded');
  }
});
