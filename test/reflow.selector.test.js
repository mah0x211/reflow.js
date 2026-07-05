import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow, ReflowSelectorError } from '../src/index.js';

test('api: render() with selector returns matched fragment', async () => {
    const r = new Reflow();
    await r.compile('t', '<div><header id="h"><h1>Hi</h1></header><main>x</main></div>');
    const out = r.render('t', {}, '#h');
    assert.equal(out, '<header id="h"><h1>Hi</h1></header>');
});

test('api: Reflow.compileSelector produces a reusable CompiledSelector', async () => {
    const r = new Reflow();
    await r.compile('t', '<div><p id="a">1</p></div>');
    const sel = Reflow.compileSelector('#a');
    assert.equal(r.render('t', {}, sel), '<p id="a">1</p>');
    // Passing the same compiled selector twice does not mutate cache.
    r.render('t', {}, sel);
    assert.equal(r._selectorCache.size, 0);
});

test('api: raw string selector populates the cache', async () => {
    const r = new Reflow({ selectorCacheSize: 4 });
    await r.compile('t', '<div><p id="a">1</p></div>');
    r.render('t', {}, '#a');
    assert.equal(r._selectorCache.size, 1);
    r.render('t', {}, '#a');
    assert.equal(r._selectorCache.size, 1);
});

test('api: selectorCacheSize=0 disables caching', async () => {
    const r = new Reflow({ selectorCacheSize: 0 });
    await r.compile('t', '<div><p id="a">1</p></div>');
    r.render('t', {}, '#a');
    r.render('t', {}, '#a');
    assert.equal(r._selectorCache.size, 0);
});

test('api: default cache size is 128', () => {
    const r = new Reflow();
    assert.equal(r._selectorCache.maxSize, 128);
});

test('api: without selector, render behaves exactly as before', async () => {
    const r = new Reflow();
    await r.compile('t', '<div><span>x</span></div>');
    assert.equal(r.render('t'), '<div><span>x</span></div>');
    assert.equal(r.render('t', {}), '<div><span>x</span></div>');
    assert.equal(r.render('t', {}, undefined), '<div><span>x</span></div>');
});

test('api: no_match error surfaces from public render', async () => {
    const r = new Reflow();
    await r.compile('t', '<div></div>');
    assert.throws(
        () => r.render('t', {}, '#absent'),
        (e) => {
            assert.ok(e instanceof ReflowSelectorError);
            assert.equal(e.reason, 'no_match');
            return true;
        }
    );
});

test('api: multiple_matches error surfaces from public render', async () => {
    const r = new Reflow();
    await r.compile('t', '<div><p class="x">1</p><p class="x">2</p></div>');
    assert.throws(
        () => r.render('t', {}, '.x'),
        (e) => e.reason === 'multiple_matches'
    );
});

test('api: syntax error from raw string surfaces as ReflowSelectorError', async () => {
    const r = new Reflow();
    await r.compile('t', '<div></div>');
    assert.throws(
        () => r.render('t', {}, '::before'),
        (e) => e instanceof ReflowSelectorError && e.reason === 'unsupported'
    );
});

test('api: Reflow.render (static one-shot) supports selector', async () => {
    const out = await Reflow.render(
        '<div><span id="x">yo</span><span>other</span></div>',
        {},
        { selector: '#x' }
    );
    assert.equal(out, '<span id="x">yo</span>');
});

test('api: Reflow.renderFile supports selector via config', async () => {
    const loader = async (p) => {
        assert.equal(p, 'virtual/path');
        return '<div><span id="x">yo</span></div>';
    };
    const out = await Reflow.renderFile('virtual/path', {}, { loader, selector: '#x' });
    assert.equal(out, '<span id="x">yo</span>');
});

test('api: template not found error still fires when selector present', async () => {
    const r = new Reflow();
    assert.throws(
        () => r.render('nope', {}, '#x'),
        (e) => e.name === 'ReflowRuntimeError' && e.reason === 'not_found'
    );
});

test('api: helper reachable from fragment render', async () => {
    const r = new Reflow({ helpers: { upper: (s) => String(s).toUpperCase() } });
    await r.compile('t', '<div><span id="s" x-text="upper($.n)"></span></div>');
    assert.equal(r.render('t', { n: 'hi' }, '#s'), '<span id="s">HI</span>');
});

test('api: cross-include selector via public render', async () => {
    const r = new Reflow();
    await r.compile('layout', '<html><body><main x-include="$.body"></main></body></html>');
    await r.compile('page', '<section><div id="target"><p>hello</p></div></section>');
    assert.equal(
        r.render('layout', { body: 'page' }, '#target'),
        '<div id="target"><p>hello</p></div>'
    );
});
