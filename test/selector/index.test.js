import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow } from '../../src/index.js';
import {
    buildTemplateIndex,
    computeControlPath,
    elementRequiresExecution,
    getStaticAttr,
    getStaticClassSet,
    sortByDocumentOrder,
} from '../../src/selector/index.js';

async function compile(html) {
    const r = new Reflow();
    await r.compile('t', html);
    // Peek at internal state to reach the compiled root.
    // Reflow keeps templates in a private map; use the public render path once
    // to force compilation and then reach into the map via a workaround: we
    // instead read the internal Map directly using bracket access on the
    // instance's own property.
    const compiled = r._templates.get('t');
    return compiled;
}

test('index: byTag / byId / byClass / byAttrName populate from static attrs', async () => {
    const c = await compile(`
        <section id="wrap" class="a b" data-role="main">
            <p class="a">first</p>
            <span id="s1"></span>
        </section>
    `);
    const idx = c.index;
    assert.equal(idx.byTag.get('section').length, 1);
    assert.equal(idx.byTag.get('p').length, 1);
    assert.equal(idx.byTag.get('span').length, 1);
    assert.equal(idx.byId.get('wrap').length, 1);
    assert.equal(idx.byId.get('s1').length, 1);
    assert.equal(idx.byClass.get('a').length, 2);
    assert.equal(idx.byClass.get('b').length, 1);
    assert.equal(idx.byAttrName.get('data-role').length, 1);
    assert.equal(idx.byAttrName.get('class').length, 2);
});

test('index: annotates parent / depth / order on every element', async () => {
    const c = await compile(`<section><p><span></span></p></section>`);
    const section = c.index.byTag.get('section')[0];
    const p = c.index.byTag.get('p')[0];
    const span = c.index.byTag.get('span')[0];
    assert.equal(section.parent, null);
    assert.equal(section.depth, 0);
    assert.equal(p.parent, section);
    assert.equal(p.depth, 1);
    assert.equal(span.parent, p);
    assert.equal(span.depth, 2);
    assert.ok(section.order < p.order);
    assert.ok(p.order < span.order);
});

test('index: chain branches share the chain wrapper enclosing element as parent', async () => {
    const c = await compile(`
        <ul>
            <li>a</li>
            <li x-if="$.cond">b</li>
            <li x-else>c</li>
        </ul>
    `);
    const ul = c.index.byTag.get('ul')[0];
    const lis = c.index.byTag.get('li');
    assert.equal(lis.length, 3);
    for (const li of lis) {
        assert.equal(li.parent, ul, 'chain branch parent should be the ul');
        assert.equal(li.depth, 1);
    }
    const [_a, ifLi, elseLi] = lis;
    assert.equal(_a.chainBranch, null);
    assert.deepEqual(
        { branchIndex: ifLi.chainBranch.branchIndex },
        { branchIndex: 0 },
    );
    assert.equal(ifLi.chainBranch.chain.type, 'chain');
    assert.equal(elseLi.chainBranch.branchIndex, 1);
    // Solo chain branch has no chainBranch mark on non-chain siblings
    assert.equal(_a.chainBranch, null);
    assert.equal(_a.matchBranch, null);
});

test('index: x-match cases are annotated as matchBranch and their parent is the x-match element', async () => {
    const c = await compile(`
        <div x-match="$.tab">
            <section x-case="'a'"><p>a</p></section>
            <section x-case="'b'"><p>b</p></section>
            <section x-nocase><p>fallback</p></section>
        </div>
    `);
    const div = c.index.byTag.get('div')[0];
    const sections = c.index.byTag.get('section');
    assert.equal(sections.length, 3);
    for (const s of sections) {
        assert.equal(s.parent, div);
        assert.equal(s.depth, 1);
        assert.ok(s.matchBranch);
    }
    assert.deepEqual(sections.map(s => s.matchBranch.branchIndex), [0, 1, 2]);
    // Grandchildren (p) live under the case element
    const ps = c.index.byTag.get('p');
    assert.equal(ps.length, 3);
    for (const p of ps) {
        assert.equal(p.parent.tagName, 'section');
        assert.equal(p.depth, 2);
    }
});

test('index: x-include-bearing elements are collected', async () => {
    const c = await compile(`
        <div>
            <main x-include="$.contentTemplate"></main>
            <aside x-include="'sidebar'"></aside>
        </div>
    `);
    assert.equal(c.index.includes.length, 2);
    const tags = c.index.includes.map(e => e.tagName);
    assert.deepEqual(tags.sort(), ['aside', 'main']);
});

test('computeControlPath: skips ancestors without control-flow', async () => {
    const c = await compile(`
        <div><section><article><p><span></span></p></article></section></div>
    `);
    const span = c.index.byTag.get('span')[0];
    assert.deepEqual(computeControlPath(span), []);
});

test('computeControlPath: includes x-data / x-if / x-for / x-each / x-match ancestors', async () => {
    const c = await compile(`
        <div x-data="page: { title: 'x' }">
            <ul x-if="$.cond">
                <li x-each="u, i in $.users">
                    <div x-match=".u.role">
                        <span x-case="'a'">
                            <em x-for="k = 1, 3">deep</em>
                        </span>
                    </div>
                </li>
            </ul>
        </div>
    `);
    const em = c.index.byTag.get('em')[0];
    const path = computeControlPath(em);
    const tags = path.map(e => e.tagName);
    // Expected: div (x-data), ul (chainBranch from x-if), li (x-each), span (matchBranch)
    // em itself has x-for but computeControlPath excludes the target
    assert.deepEqual(tags, ['div', 'ul', 'li', 'span']);
    assert.ok(path[0].directives.data);
    assert.ok(path[1].chainBranch);
    assert.ok(path[2].directives.each);
    assert.ok(path[3].matchBranch);
});

test('elementRequiresExecution: returns true for control-flow, false for plain', async () => {
    const c = await compile(`
        <div>
            <p x-data="foo: {}">1</p>
            <p x-if="$.a">2</p>
            <p x-each="x in $.xs">3</p>
            <p x-for="i = 1, 3">4</p>
            <p>5</p>
        </div>
    `);
    const ps = c.index.byTag.get('p');
    // p[0] x-data, p[1] x-if (chainBranch), p[2] x-each, p[3] x-for, p[4] plain
    assert.equal(elementRequiresExecution(ps[0]), true);
    assert.equal(elementRequiresExecution(ps[1]), true);
    assert.equal(elementRequiresExecution(ps[2]), true);
    assert.equal(elementRequiresExecution(ps[3]), true);
    assert.equal(elementRequiresExecution(ps[4]), false);
    assert.equal(elementRequiresExecution(null), false);
});

test('getStaticAttr / getStaticClassSet: read attribute values', async () => {
    const c = await compile(`<div id="x" class="a  b\tc" data-role="main"></div>`);
    const div = c.index.byTag.get('div')[0];
    assert.equal(getStaticAttr(div, 'id'), 'x');
    assert.equal(getStaticAttr(div, 'data-role'), 'main');
    assert.equal(getStaticAttr(div, 'nonexistent'), null);
    const classes = getStaticClassSet(div);
    assert.deepEqual([...classes].sort(), ['a', 'b', 'c']);
});

test('getStaticClassSet: empty for missing / empty class attribute', async () => {
    const c = await compile(`<div></div>`);
    const div = c.index.byTag.get('div')[0];
    assert.equal(getStaticClassSet(div).size, 0);
});

test('sortByDocumentOrder: orders elements by their assigned order field', async () => {
    const c = await compile(`
        <section>
            <p>a</p>
            <div>
                <p>b</p>
                <p>c</p>
            </div>
        </section>
    `);
    const ps = c.index.byTag.get('p');
    const shuffled = [ps[2], ps[0], ps[1]];
    const sorted = sortByDocumentOrder(shuffled);
    assert.deepEqual(sorted, ps);
    // Original list is untouched
    assert.deepEqual(shuffled, [ps[2], ps[0], ps[1]]);
});

test('buildTemplateIndex: ignores text and comment nodes', () => {
    // Directly test with a synthetic root to keep coverage of the branch.
    const root = { type: 'root', children: [{ type: 'text', text: 'x' }, { type: 'comment', text: 'y' }] };
    const idx = buildTemplateIndex(root);
    assert.equal(idx.byTag.size, 0);
    assert.equal(idx.byId.size, 0);
    assert.equal(idx.byClass.size, 0);
});

test('buildTemplateIndex: handles empty id and class attribute values', async () => {
    const c = await compile(`<div id="" class=""></div>`);
    // Empty id / class should not register buckets
    assert.equal(c.index.byId.size, 0);
    assert.equal(c.index.byClass.size, 0);
    // But byAttrName still tracks them
    assert.equal(c.index.byAttrName.get('id').length, 1);
    assert.equal(c.index.byAttrName.get('class').length, 1);
});
