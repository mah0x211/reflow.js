import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWith } from '../../src/directives/parsers.js';

test('parseWith: single binding with primitive', () => {
  const { bindings } = parseWith('a = 1');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].name, 'a');
  assert.equal(bindings[0].expr.type, 'literal');
  assert.equal(bindings[0].expr.value, 1);
});

test('parseWith: multiple bindings separated by commas', () => {
  const { bindings } = parseWith(`a = 1, b = 'x', c = true`);
  assert.deepEqual(bindings.map((b) => b.name), ['a', 'b', 'c']);
});

test('parseWith: commas inside object / array literals are not binding separators', () => {
  const { bindings } = parseWith(`a = { x: 1, y: 2 }, b = [1, 2, 3]`);
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0].name, 'a');
  assert.equal(bindings[0].expr.type, 'object');
  assert.equal(bindings[1].name, 'b');
  assert.equal(bindings[1].expr.type, 'array');
});

test('parseWith: commas inside helper calls are not binding separators', () => {
  const { bindings } = parseWith(`a = concat(1, 2, 3), b = 4`);
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0].name, 'a');
  assert.equal(bindings[0].expr.type, 'call');
  assert.equal(bindings[0].expr.args.length, 3);
});

test('parseWith: commas inside string literals are not binding separators', () => {
  const { bindings } = parseWith(`a = 'one, two, three', b = 'x'`);
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0].expr.value, 'one, two, three');
});

test('parseWith: escaped quotes inside string literals do not terminate the string', () => {
  const { bindings } = parseWith(`a = 'it\\'s a test', b = 2`);
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0].expr.value, "it's a test");
});

test('parseWith: scope reference RHS', () => {
  const { bindings } = parseWith(`a = $.name, b = @outer.value, c = .item.field`);
  assert.equal(bindings[0].expr.type, 'member');
  assert.equal(bindings[1].expr.type, 'member');
  assert.equal(bindings[2].expr.type, 'member');
});

test('parseWith: rejects duplicate binding names', () => {
  assert.throws(() => parseWith('a = 1, b = 2, a = 3'), /duplicate binding name "a"/);
});

test('parseWith: rejects missing "="', () => {
  assert.throws(() => parseWith('a'), /expected "="/);
  assert.throws(() => parseWith('a b'), /expected "="/);
});

test('parseWith: rejects missing binding name', () => {
  assert.throws(() => parseWith('= 1'), /expected binding name/);
  assert.throws(() => parseWith('123 = 1'), /expected binding name/);
});

test('parseWith: rejects empty value', () => {
  assert.throws(() => parseWith(''), /at least one binding/);
  assert.throws(() => parseWith('   '), /at least one binding/);
});

test('parseWith: rejects binding with empty expression', () => {
  assert.throws(() => parseWith('a = '), /value expression is required for binding "a"/);
  assert.throws(() => parseWith('a = , b = 1'), /value expression is required for binding "a"/);
});

test('parseWith: rejects unbalanced brackets', () => {
  assert.throws(() => parseWith('a = { x: 1'), /unbalanced brackets/);
  assert.throws(() => parseWith('a = [1, 2'), /unbalanced brackets/);
  assert.throws(() => parseWith('a = 1 }'), /unbalanced "\}"/);
});

test('parseWith: rejects unterminated string', () => {
  assert.throws(() => parseWith(`a = 'unterminated`), /unterminated string literal/);
});

test('parseWith: rejects invalid expression', () => {
  assert.throws(() => parseWith('a = 1 + 2'), /x-with: .* \(in binding "a"\)/);
});

test('parseWith: trailing comma at top level is tolerated', () => {
  const { bindings } = parseWith('a = 1,');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].name, 'a');
});

test('parseWith: tolerates whitespace around tokens', () => {
  const { bindings } = parseWith(`   a   =   1  ,   b  =  'x'   `);
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0].name, 'a');
  assert.equal(bindings[1].expr.value, 'x');
});

test('parseWith: newlines between bindings are allowed', () => {
  const { bindings } = parseWith(`
    a = 1,
    b = {
      x: 1,
      y: 2,
    },
    c = 'ok'
  `);
  assert.equal(bindings.length, 3);
});
