import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SelectorCache } from '../../src/selector/cache.js';
import { parseSelector } from '../../src/selector/parse.js';
import { ReflowSelectorError } from '../../src/errors.js';

test('cache: default size 128', () => {
    const c = new SelectorCache();
    assert.equal(c.maxSize, 128);
    assert.equal(c.size, 0);
});

test('cache: parses on miss and returns same instance on hit', () => {
    const c = new SelectorCache(16);
    const a = c.resolve('#header');
    const b = c.resolve('#header');
    assert.equal(a, b);
    assert.equal(c.size, 1);
});

test('cache: separate strings produce separate entries', () => {
    const c = new SelectorCache(16);
    c.resolve('#a');
    c.resolve('.b');
    c.resolve('c');
    assert.equal(c.size, 3);
});

test('cache: pre-compiled input bypasses cache', () => {
    const c = new SelectorCache(16);
    const pre = parseSelector('#header');
    const out = c.resolve(pre);
    assert.equal(out, pre);
    assert.equal(c.size, 0);
});

test('cache: invalid selectors are NOT cached', () => {
    const c = new SelectorCache(16);
    // Feed several distinct invalid strings; each should throw and not cache
    for (const bad of ['??', ':nth-child(2n+1)', '::before', 'a + b']) {
        assert.throws(() => c.resolve(bad), ReflowSelectorError);
    }
    assert.equal(c.size, 0);
});

test('cache: LRU evicts oldest when size exceeds maxSize', () => {
    const c = new SelectorCache(2);
    c.resolve('#a');
    c.resolve('#b');
    assert.equal(c.size, 2);
    c.resolve('#c');
    assert.equal(c.size, 2);
    // #a should be evicted (oldest)
    assert.equal(c.peek('#a'), undefined);
    assert.ok(c.peek('#b'));
    assert.ok(c.peek('#c'));
});

test('cache: hit refreshes recency (moves entry to newest)', () => {
    const c = new SelectorCache(2);
    c.resolve('#a');
    c.resolve('#b');
    // Access #a to make it the newest; then insert #c to evict oldest (#b)
    c.resolve('#a');
    c.resolve('#c');
    assert.ok(c.peek('#a'));
    assert.equal(c.peek('#b'), undefined);
    assert.ok(c.peek('#c'));
});

test('cache: size 0 disables caching entirely', () => {
    const c = new SelectorCache(0);
    const a = c.resolve('#a');
    const b = c.resolve('#a');
    // Different instances because each call re-parses
    assert.notEqual(a, b);
    assert.equal(c.size, 0);
});

test('cache: constructor rejects negative or non-integer maxSize', () => {
    assert.throws(() => new SelectorCache(-1), TypeError);
    assert.throws(() => new SelectorCache(1.5), TypeError);
    assert.throws(() => new SelectorCache('10'), TypeError);
});

test('cache: clear empties the cache', () => {
    const c = new SelectorCache(4);
    c.resolve('#a');
    c.resolve('#b');
    assert.equal(c.size, 2);
    c.clear();
    assert.equal(c.size, 0);
});

test('cache: peek does not affect recency', () => {
    const c = new SelectorCache(2);
    c.resolve('#a');
    c.resolve('#b');
    c.peek('#a'); // does not refresh
    c.resolve('#c'); // should evict #a as oldest
    assert.equal(c.peek('#a'), undefined);
    assert.ok(c.peek('#b'));
});

test('cache: non-string, non-compiled input delegates to parseSelector for a typed error', () => {
    const c = new SelectorCache(4);
    assert.throws(() => c.resolve(null), ReflowSelectorError);
    assert.throws(() => c.resolve(42), ReflowSelectorError);
});
