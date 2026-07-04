import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeText, escapeAttr } from '../../src/escape.js';

test('escapeText escapes < > & " \'', () => {
  assert.equal(escapeText('a<b>c&d"e\'f'), 'a&lt;b&gt;c&amp;d&quot;e&#39;f');
});

test('escapeText passes plain ASCII through', () => {
  assert.equal(escapeText('hello world 123'), 'hello world 123');
});

test('escapeText coerces non-string values', () => {
  assert.equal(escapeText(42), '42');
  assert.equal(escapeText(true), 'true');
  assert.equal(escapeText(null), 'null');
});

test('escapeAttr escapes < > & " but not \'', () => {
  assert.equal(escapeAttr('<>&"\''), '&lt;&gt;&amp;&quot;\'');
});

test('escapeText handles unicode', () => {
  assert.equal(escapeText('日本語 <em>'), '日本語 &lt;em&gt;');
});
