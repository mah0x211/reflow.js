import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanElementRanges } from '../../src/scanner.js';

test('scans plain elements', () => {
  const html = '<div><p>hi</p><span/></div>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['div', 'p', 'span']);
  assert.equal(html.slice(r[0].start, r[0].end), '<div>');
  assert.equal(html.slice(r[1].start, r[1].end), '<p>');
  assert.equal(html.slice(r[2].start, r[2].end), '<span/>');
});

test('skips comments', () => {
  const html = '<!-- <p>ignored</p> --><div><p>hi</p></div>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['div', 'p']);
});

test('skips doctype', () => {
  const html = '<!DOCTYPE html><div></div>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['div']);
});

test('respects quoted attribute values with > inside', () => {
  const html = '<a href="x?y=1>2">link</a>';
  const r = scanElementRanges(html);
  assert.equal(r.length, 1);
  assert.equal(r[0].tagName, 'a');
  assert.equal(html.slice(r[0].start, r[0].end), '<a href="x?y=1>2">');
});

test('skips script content', () => {
  const html = '<script>if (a<b) {}</script><p>hi</p>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['script', 'p']);
});

test('skips style content', () => {
  const html = '<style>a>b{color:red}</style><p>hi</p>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['style', 'p']);
});

test('handles nested elements', () => {
  const html = '<div><section><p>hi</p></section></div>';
  const r = scanElementRanges(html);
  assert.deepEqual(r.map((x) => x.tagName), ['div', 'section', 'p']);
});
