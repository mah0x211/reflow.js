import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanElementRanges } from '../../src/scanner.js';
import { offsetToLineCol, makeSnippet } from '../../src/snippet.js';
import { createEnv } from '../../src/scope.js';

test('scanner: handles processing instructions', () => {
  const html = '<?xml version="1.0"?><div></div>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['div']);
});

test('scanner: handles stray < character', () => {
  const html = '<div>a < b</div>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['div']);
});

test('scanner: handles unterminated comment', () => {
  const html = '<!-- never closed <div></div>';
  const r = scanElementRanges(html);
  assert.deepEqual(r, []);
});

test('scanner: handles unterminated doctype', () => {
  const html = '<!DOCTYPE never closed';
  const r = scanElementRanges(html);
  assert.deepEqual(r, []);
});

test('scanner: handles unterminated processing instruction', () => {
  const html = '<?xml never closed';
  const r = scanElementRanges(html);
  assert.deepEqual(r, []);
});

test('scanner: handles unterminated close tag', () => {
  const html = '<div></div  never closed';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['div']);
});

test('scanner: handles unterminated open tag', () => {
  const html = '<div attr="never closed';
  const r = scanElementRanges(html);
  assert.deepEqual(r, []);
});

test('scanner: handles unterminated script content', () => {
  const html = '<script>never closed';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['script']);
});

test('scanner: allows uppercase tag names normalized', () => {
  const html = '<DIV></DIV>';
  const r = scanElementRanges(html);
  assert.equal(r[0].tagName, 'div');
});

test('snippet: offset before start clamps to 0', () => {
  const { line, column } = offsetToLineCol('abc', -10);
  assert.equal(line, 1);
  assert.equal(column, 1);
});

test('snippet: offset past end clamps to length', () => {
  const { line, column } = offsetToLineCol('abc', 1000);
  assert.equal(line, 1);
  assert.equal(column, 4);
});

test('snippet: makeSnippet with negative start', () => {
  const s = makeSnippet('abc', -5, 2);
  assert.match(s, /1 \| abc/);
});

test('snippet: makeSnippet with end beyond length', () => {
  const s = makeSnippet('abc', 0, 100);
  assert.match(s, /1 \| abc/);
});

test('snippet: makeSnippet with end < start collapses', () => {
  const s = makeSnippet('abc', 2, 1);
  assert.ok(typeof s === 'string');
});

test('snippet: multi-line highlight extends past line end', () => {
  const s = makeSnippet('aaa\nbbb\nccc', 1, 10);
  assert.match(s, /\^/);
});
