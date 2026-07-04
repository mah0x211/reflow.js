import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetToLineCol, makeSnippet } from '../../src/snippet.js';

test('offsetToLineCol at start', () => {
  assert.deepEqual(offsetToLineCol('abc', 0), { line: 1, column: 1 });
});

test('offsetToLineCol within first line', () => {
  assert.deepEqual(offsetToLineCol('abcdef', 3), { line: 1, column: 4 });
});

test('offsetToLineCol across lines', () => {
  const s = 'hello\nworld\n';
  assert.deepEqual(offsetToLineCol(s, 6), { line: 2, column: 1 });
  assert.deepEqual(offsetToLineCol(s, 8), { line: 2, column: 3 });
});

test('makeSnippet includes context lines and caret', () => {
  const src = 'aaa\nbbb\nccc\nddd\neee\n';
  const s = makeSnippet(src, 8, 11, 1);
  assert.match(s, /2 \| bbb/);
  assert.match(s, /3 \| ccc/);
  assert.match(s, /4 \| ddd/);
  assert.match(s, /\^\^\^/);
});
