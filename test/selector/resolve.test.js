import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow } from '../../src/index.js';
import { parseSelector } from '../../src/selector/parse.js';
import { resolveSelector, evalPositional } from '../../src/selector/resolve.js';

async function compile(html) {
    const r = new Reflow();
    await r.compile('t', html);
    return r._templates.get('t');
}

function names(candidates) {
    return candidates.map(c => c.element.tagName + (staticId(c.element) ? '#' + staticId(c.element) : ''));
}

function staticId(el) {
    for (const [n, v] of el.attrs) if (n === 'id') return v;
    return null;
}

test('resolve: #id seeds directly', async () => {
    const c = await compile('<div><section id="hero"></section><span id="hero-dupe"></span></div>');
    const cand = resolveSelector(c.index, parseSelector('#hero'));
    assert.equal(cand.length, 1);
    assert.equal(cand[0].element.tagName, 'section');
    assert.deepEqual(cand[0].positional, []);
});

test('resolve: .class seeds by class', async () => {
    const c = await compile('<div class="a b"></div><span class="a"></span><em class="c"></em>');
    const cand = resolveSelector(c.index, parseSelector('.a'));
    assert.deepEqual(names(cand).sort(), ['div', 'span']);
});

test('resolve: multiple classes require all to match', async () => {
    const c = await compile('<div class="a b"></div><span class="a"></span>');
    const cand = resolveSelector(c.index, parseSelector('.a.b'));
    assert.deepEqual(names(cand), ['div']);
});

test('resolve: tag seed for bare type selector', async () => {
    const c = await compile('<section><article></article></section><div></div>');
    const cand = resolveSelector(c.index, parseSelector('article'));
    assert.deepEqual(names(cand), ['article']);
});

test('resolve: attribute-name seed for bare [attr]', async () => {
    const c = await compile('<div data-role="a"></div><span data-role="b"></span><em></em>');
    const cand = resolveSelector(c.index, parseSelector('[data-role]'));
    assert.deepEqual(names(cand).sort(), ['div', 'span']);
});

test('resolve: attribute value operators', async () => {
    const c = await compile(`
        <a href="https://example.com/foo"></a>
        <a href="/bar"></a>
        <a href="mailto:test"></a>
        <a title="one two three"></a>
    `);
    assert.deepEqual(
        names(resolveSelector(c.index, parseSelector('[href^="https"]'))),
        ['a']
    );
    assert.deepEqual(
        names(resolveSelector(c.index, parseSelector('[href$="/bar"]'))),
        ['a']
    );
    assert.deepEqual(
        names(resolveSelector(c.index, parseSelector('[href*="example"]'))),
        ['a']
    );
    assert.deepEqual(
        names(resolveSelector(c.index, parseSelector('[title~="two"]'))),
        ['a']
    );
    assert.deepEqual(
        names(resolveSelector(c.index, parseSelector('[title~="four"]'))),
        []
    );
});

test('resolve: |= matches exact or hyphen-prefix', async () => {
    const c = await compile(`
        <p lang="en"></p>
        <p lang="en-US"></p>
        <p lang="fr"></p>
    `);
    const cand = resolveSelector(c.index, parseSelector('[lang|="en"]'));
    assert.equal(cand.length, 2);
});

test('resolve: descendant combinator matches any depth', async () => {
    const c = await compile(`
        <section>
            <ul>
                <li>
                    <p><span>deep</span></p>
                </li>
            </ul>
        </section>
    `);
    const cand = resolveSelector(c.index, parseSelector('section span'));
    assert.deepEqual(names(cand), ['span']);
});

test('resolve: child combinator requires direct parent', async () => {
    const c = await compile(`
        <ul>
            <li>direct</li>
            <div><li>nested</li></div>
        </ul>
    `);
    const cand = resolveSelector(c.index, parseSelector('ul > li'));
    // Only the direct child li matches.
    assert.equal(cand.length, 1);
});

test('resolve: multi-part complex selector', async () => {
    const c = await compile(`
        <section id="posts">
            <article>
                <div class="body">
                    <p>x</p>
                </div>
            </article>
        </section>
    `);
    const cand = resolveSelector(c.index, parseSelector('#posts article > .body p'));
    assert.equal(cand.length, 1);
    assert.equal(cand[0].element.tagName, 'p');
});

test('resolve: selector list unions and deduplicates', async () => {
    const c = await compile(`
        <div id="a"></div>
        <div class="b"></div>
        <div id="a" class="b"></div>
    `);
    const cand = resolveSelector(c.index, parseSelector('#a, .b'));
    // Three matches by set semantics: two #a plus one .b that's also #a.
    // Wait - the last div has id="a" too, so byId#a returns two elements.
    // Then .b returns two elements (the one with class="b" and the one with id="a" class="b").
    // Unioned: three unique divs.
    assert.equal(cand.length, 3);
});

test('resolve: candidates are sorted in document order', async () => {
    const c = await compile(`
        <section>
            <p class="target">first</p>
            <div><p class="target">second</p></div>
            <p class="target">third</p>
        </section>
    `);
    const cand = resolveSelector(c.index, parseSelector('.target'));
    assert.equal(cand.length, 3);
    // Document order preserved
    assert.ok(cand[0].element.order < cand[1].element.order);
    assert.ok(cand[1].element.order < cand[2].element.order);
});

test('resolve: chain branches are reachable and share the enclosing parent for combinators', async () => {
    const c = await compile(`
        <ul id="list">
            <li>a</li>
            <li x-if="$.cond">b</li>
            <li x-else>c</li>
        </ul>
    `);
    const cand = resolveSelector(c.index, parseSelector('#list > li'));
    // All three li are direct children of ul (chain is transparent).
    assert.equal(cand.length, 3);
});

test('resolve: x-match cases are reachable as children of the x-match element', async () => {
    const c = await compile(`
        <div id="wrap" x-match="$.k">
            <section x-case="'a'">A</section>
            <section x-case="'b'">B</section>
        </div>
    `);
    const cand = resolveSelector(c.index, parseSelector('#wrap > section'));
    assert.equal(cand.length, 2);
});

test('resolve: positional pseudo-classes flow to candidates on the rightmost compound', async () => {
    const c = await compile('<ul><li>1</li><li>2</li><li>3</li></ul>');
    const cand = resolveSelector(c.index, parseSelector('li:nth-child(2)'));
    // Static candidates are all three li; positional is applied at render time.
    assert.equal(cand.length, 3);
    for (const p of cand) {
        assert.deepEqual(p.positional, [{ name: 'nth-child', n: 2 }]);
    }
});

test('resolve: rejects positional pseudos on non-rightmost compound', async () => {
    const c = await compile('<ul><li><p>x</p></li></ul>');
    assert.throws(
        () => resolveSelector(c.index, parseSelector('li:first-child p')),
        (e) => {
            assert.equal(e.reason, 'unsupported');
            assert.match(e.feature, /^pseudo-ancestor:/);
            return true;
        }
    );
});

test('resolve: no seed bucket returns empty', async () => {
    const c = await compile('<div></div>');
    assert.equal(resolveSelector(c.index, parseSelector('#nothing')).length, 0);
    assert.equal(resolveSelector(c.index, parseSelector('.nope')).length, 0);
    assert.equal(resolveSelector(c.index, parseSelector('nosuchtag')).length, 0);
    assert.equal(resolveSelector(c.index, parseSelector('[data-none]')).length, 0);
});

test('resolve: universal / bare positional falls back to all elements', async () => {
    const c = await compile('<div><p></p></div>');
    const cand = resolveSelector(c.index, parseSelector('*'));
    // div and p are matched
    assert.equal(cand.length, 2);
});

test('resolve: attribute intersection uses smallest bucket', async () => {
    // Two attribute conditions with disjoint value ops on same name.
    const c = await compile(`
        <div data-role="header"></div>
        <div data-role="footer"></div>
        <div data-tag="x"></div>
    `);
    const cand = resolveSelector(c.index, parseSelector('[data-role][data-tag]'));
    // No element has both.
    assert.equal(cand.length, 0);
});

test('evalPositional: first-child / last-child / only-child', () => {
    assert.equal(evalPositional({ name: 'first-child', n: null }, { index: 1, total: 5, ofTypeIndex: 1, ofTypeTotal: 5 }), true);
    assert.equal(evalPositional({ name: 'first-child', n: null }, { index: 2, total: 5, ofTypeIndex: 2, ofTypeTotal: 5 }), false);
    assert.equal(evalPositional({ name: 'last-child', n: null }, { index: 5, total: 5, ofTypeIndex: 5, ofTypeTotal: 5 }), true);
    assert.equal(evalPositional({ name: 'last-child', n: null }, { index: 3, total: 5, ofTypeIndex: 3, ofTypeTotal: 5 }), false);
    assert.equal(evalPositional({ name: 'only-child', n: null }, { index: 1, total: 1, ofTypeIndex: 1, ofTypeTotal: 1 }), true);
    assert.equal(evalPositional({ name: 'only-child', n: null }, { index: 1, total: 2, ofTypeIndex: 1, ofTypeTotal: 2 }), false);
});

test('evalPositional: *-of-type variants', () => {
    assert.equal(evalPositional({ name: 'first-of-type', n: null }, { index: 3, total: 5, ofTypeIndex: 1, ofTypeTotal: 2 }), true);
    assert.equal(evalPositional({ name: 'last-of-type', n: null }, { index: 5, total: 5, ofTypeIndex: 2, ofTypeTotal: 2 }), true);
    assert.equal(evalPositional({ name: 'only-of-type', n: null }, { index: 1, total: 3, ofTypeIndex: 1, ofTypeTotal: 1 }), true);
    assert.equal(evalPositional({ name: 'only-of-type', n: null }, { index: 1, total: 3, ofTypeIndex: 1, ofTypeTotal: 2 }), false);
});

test('evalPositional: nth-* forms', () => {
    assert.equal(evalPositional({ name: 'nth-child', n: 3 }, { index: 3, total: 5, ofTypeIndex: 3, ofTypeTotal: 5 }), true);
    assert.equal(evalPositional({ name: 'nth-last-child', n: 2 }, { index: 4, total: 5, ofTypeIndex: 4, ofTypeTotal: 5 }), true);
    assert.equal(evalPositional({ name: 'nth-of-type', n: 2 }, { index: 3, total: 5, ofTypeIndex: 2, ofTypeTotal: 5 }), true);
    assert.equal(evalPositional({ name: 'nth-last-of-type', n: 1 }, { index: 3, total: 5, ofTypeIndex: 5, ofTypeTotal: 5 }), true);
});
