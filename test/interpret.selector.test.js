import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow, ReflowSelectorError, ReflowIncludeError, ReflowRuntimeError } from '../src/index.js';
import { parseSelector } from '../src/selector/parse.js';
import { renderFragment } from '../src/interpret.js';

async function setup(templates) {
    const r = new Reflow();
    for (const [name, html] of Object.entries(templates)) {
        await r.compile(name, html);
    }
    return r;
}

function fragment(reflow, name, selectorSource, data = {}) {
    const compiled = reflow._templates.get(name);
    return renderFragment({
        name,
        compiled,
        data,
        helpers: reflow._helpers,
        templates: reflow._templates,
        maxIncludeDepth: reflow._maxIncludeDepth,
        selector: parseSelector(selectorSource),
    });
}

test('fragment: simple #id extraction from a static template', async () => {
    const r = await setup({
        page: '<div><header id="hdr"><h1>Hello</h1></header><main>body</main></div>',
    });
    const out = fragment(r, 'page', '#hdr');
    assert.equal(out, '<header id="hdr"><h1>Hello</h1></header>');
});

test('fragment: renders x-text / x-bind inside the matched subtree', async () => {
    const r = await setup({
        page: `<section><article id="post" x-bind:data-slug="$.slug"><h1 x-text="$.title"></h1><p x-text="$.body"></p></article></section>`,
    });
    const out = fragment(r, 'page', '#post', { slug: 'x', title: 'T', body: 'B' });
    assert.equal(out, '<article id="post" data-slug="x"><h1>T</h1><p>B</p></article>');
});

test('fragment: candidate inside x-data ancestor sees the scope', async () => {
    const r = await setup({
        page: `
            <div x-data="page: { title: 'A' }">
                <span id="tag" x-text="@page.title"></span>
            </div>
        `,
    });
    const out = fragment(r, 'page', '#tag');
    assert.equal(out, '<span id="tag">A</span>');
});

test('fragment: candidate inside x-if truthy branch renders', async () => {
    const r = await setup({
        page: `
            <div>
                <p x-if="$.show" id="p">visible</p>
            </div>
        `,
    });
    assert.equal(fragment(r, 'page', '#p', { show: true }), '<p id="p">visible</p>');
});

test('fragment: candidate inside x-if false branch is unreachable → no_match', async () => {
    const r = await setup({
        page: `
            <div>
                <p x-if="$.show" id="p">visible</p>
            </div>
        `,
    });
    assert.throws(
        () => fragment(r, 'page', '#p', { show: false }),
        (e) => {
            assert.ok(e instanceof ReflowSelectorError);
            assert.equal(e.reason, 'no_match');
            return true;
        }
    );
});

test('fragment: chain evaluation picks the truthy branch', async () => {
    const r = await setup({
        page: `
            <div>
                <p x-if="$.mode == 'a'" class="msg">A</p>
                <p x-elseif="$.mode == 'b'" class="msg">B</p>
                <p x-else class="msg">other</p>
            </div>
        `,
    });
    // Only 1 branch renders, so .msg is single-fragment.
    assert.equal(fragment(r, 'page', '.msg', { mode: 'a' }), '<p class="msg">A</p>');
    assert.equal(fragment(r, 'page', '.msg', { mode: 'b' }), '<p class="msg">B</p>');
    assert.equal(fragment(r, 'page', '.msg', { mode: 'c' }), '<p class="msg">other</p>');
});

test('fragment: x-match selects the matching case', async () => {
    const r = await setup({
        page: `
            <div id="wrap" x-match="$.status">
                <span x-case="'ok'" class="msg">OK</span>
                <span x-case="'fail'" class="msg">FAIL</span>
                <span x-nocase class="msg">unknown</span>
            </div>
        `,
    });
    // Only one case renders; .msg is single-fragment.
    assert.equal(fragment(r, 'page', '.msg', { status: 'ok' }), '<span class="msg">OK</span>');
    assert.equal(fragment(r, 'page', '.msg', { status: 'fail' }), '<span class="msg">FAIL</span>');
    assert.equal(fragment(r, 'page', '.msg', { status: 'other' }), '<span class="msg">unknown</span>');
});

test('fragment: x-each with more than one iteration produces multiple_matches', async () => {
    const r = await setup({
        page: `
            <ul>
                <li x-each="u in $.users" class="user" x-text=".u"></li>
            </ul>
        `,
    });
    assert.throws(
        () => fragment(r, 'page', '.user', { users: ['a', 'b'] }),
        (e) => {
            assert.equal(e.reason, 'multiple_matches');
            return true;
        }
    );
});

test('fragment: x-each with exactly one iteration is a single fragment', async () => {
    const r = await setup({
        page: `
            <ul>
                <li x-each="u in $.users" class="user" x-text=".u"></li>
            </ul>
        `,
    });
    assert.equal(fragment(r, 'page', '.user', { users: ['only'] }), '<li class="user">only</li>');
});

test('fragment: x-each with zero iterations is no_match', async () => {
    const r = await setup({
        page: `
            <ul>
                <li x-each="u in $.users" class="user" x-text=".u"></li>
            </ul>
        `,
    });
    assert.throws(
        () => fragment(r, 'page', '.user', { users: [] }),
        (e) => {
            assert.equal(e.reason, 'no_match');
            return true;
        }
    );
});

test('fragment: :nth-child selects the right runtime iteration', async () => {
    const r = await setup({
        page: `
            <ul id="users">
                <li x-each="u in $.users" class="u" x-text=".u"></li>
            </ul>
        `,
    });
    // 3 users → 3 emissions of the li. :nth-child(2) matches the 2nd.
    assert.equal(
        fragment(r, 'page', '#users > li:nth-child(2)', { users: ['a', 'b', 'c'] }),
        '<li class="u">b</li>'
    );
});

test('fragment: :nth-child respects mixed static + iterated siblings', async () => {
    // Head + iterated li + tail. Runtime position 2 depends on iteration count.
    const r = await setup({
        page: `
            <ul>
                <li>head</li>
                <li x-each="u in $.users" class="u" x-text=".u"></li>
                <li>tail</li>
            </ul>
        `,
    });
    // 2 users: emissions are [head, u[0], u[1], tail]. :nth-child(2) = u[0].
    assert.equal(
        fragment(r, 'page', 'li:nth-child(2)', { users: ['A', 'B'] }),
        '<li class="u">A</li>'
    );
    // 0 users: emissions are [head, tail]. :nth-child(2) = tail.
    assert.equal(
        fragment(r, 'page', 'li:nth-child(2)', { users: [] }),
        '<li>tail</li>'
    );
});

test('fragment: :first-child / :last-child / :only-child', async () => {
    const r = await setup({
        page: `
            <ul>
                <li x-each="u in $.users" x-text=".u"></li>
            </ul>
        `,
    });
    assert.equal(
        fragment(r, 'page', 'li:first-child', { users: ['a', 'b', 'c'] }),
        '<li>a</li>'
    );
    assert.equal(
        fragment(r, 'page', 'li:last-child', { users: ['a', 'b', 'c'] }),
        '<li>c</li>'
    );
    assert.equal(
        fragment(r, 'page', 'li:only-child', { users: ['only'] }),
        '<li>only</li>'
    );
    assert.throws(
        () => fragment(r, 'page', 'li:only-child', { users: ['a', 'b'] }),
        (e) => e.reason === 'no_match'
    );
});

test('fragment: :first-of-type / :last-of-type / :nth-of-type', async () => {
    const r = await setup({
        page: `<section><h2>title</h2><p>one</p><p>two</p><p>three</p><h2>tail</h2></section>`,
    });
    assert.equal(fragment(r, 'page', 'p:first-of-type'), '<p>one</p>');
    assert.equal(fragment(r, 'page', 'p:last-of-type'), '<p>three</p>');
    assert.equal(fragment(r, 'page', 'p:nth-of-type(2)'), '<p>two</p>');
    // Two h2s → :only-of-type does not match → no_match
    assert.throws(
        () => fragment(r, 'page', 'h2:only-of-type'),
        (e) => e.reason === 'no_match'
    );
});

test('fragment: x-match example verifying li:nth-child(2) picks the chosen case', async () => {
    const r = await setup({
        page: `
            <ul id="status" x-match="$.status">
                <li x-case="'ok'"><span>OK</span></li>
                <li x-case="'fail'"><span>Fail</span></li>
            </ul>
        `,
    });
    // ul has 1 element child (the chosen li). :nth-child(1) targets it.
    assert.equal(
        fragment(r, 'page', '#status li:first-child', { status: 'ok' }),
        '<li><span>OK</span></li>'
    );
});

test('fragment: cross-include finds a fragment defined in the included template', async () => {
    const r = await setup({
        layout: `<html><body><main x-include="$.body"></main></body></html>`,
        page: `<section><div id="target"><p>hello</p></div></section>`,
    });
    assert.equal(
        fragment(r, 'layout', '#target', { body: 'page' }),
        '<div id="target"><p>hello</p></div>'
    );
});

test('fragment: not searched into includes when current template has candidates', async () => {
    const r = await setup({
        layout: `<div><span id="here"></span><main x-include="'inner'"></main></div>`,
        inner: `<span id="here">from inside</span>`,
    });
    // #here in layout is the found candidate; the include is not walked at all.
    assert.equal(
        fragment(r, 'layout', '#here'),
        '<span id="here"></span>'
    );
});

test('fragment: cross-include multi-match still errors', async () => {
    const r = await setup({
        layout: `<div><main x-include="'inner1'"></main><aside x-include="'inner2'"></aside></div>`,
        inner1: `<div id="dupe">1</div>`,
        inner2: `<div id="dupe">2</div>`,
    });
    assert.throws(
        () => fragment(r, 'layout', '#dupe'),
        (e) => e.reason === 'multiple_matches'
    );
});

test('fragment: cross-include propagates include errors (not_found)', async () => {
    const r = await setup({
        layout: `<div><main x-include="'missing'"></main></div>`,
    });
    assert.throws(
        () => fragment(r, 'layout', '#anything'),
        (e) => e instanceof ReflowIncludeError && e.reason === 'not_found'
    );
});

test('fragment: cross-include propagates cycle errors', async () => {
    const r = await setup({
        a: `<div><main x-include="'b'"></main></div>`,
        b: `<div><main x-include="'a'"></main></div>`,
    });
    assert.throws(
        () => fragment(r, 'a', '#nothing'),
        (e) => e instanceof ReflowIncludeError && e.reason === 'cycle'
    );
});

test('fragment: multiple id matches within one template is multiple_matches', async () => {
    const r = await setup({
        page: `<div><span id="x">1</span><span id="x">2</span></div>`,
    });
    assert.throws(
        () => fragment(r, 'page', '#x'),
        (e) => e.reason === 'multiple_matches'
    );
});

test('fragment: no candidates anywhere is no_match', async () => {
    const r = await setup({
        page: `<div><span></span></div>`,
    });
    assert.throws(
        () => fragment(r, 'page', '#absent'),
        (e) => e.reason === 'no_match'
    );
});

test('fragment: x-bind on the matched element is applied', async () => {
    const r = await setup({
        page: `<div><a id="l" x-bind:href="$.u">click</a></div>`,
    });
    assert.equal(
        fragment(r, 'page', '#l', { u: '/x' }),
        '<a id="l" href="/x">click</a>'
    );
});

test('fragment: matched element with a helper reference in x-text', async () => {
    const r = new Reflow({ helpers: { upper: (s) => String(s).toUpperCase() } });
    await r.compile('t', '<div><span id="s" x-text="upper($.name)"></span></div>');
    const out = renderFragment({
        name: 't',
        compiled: r._templates.get('t'),
        data: { name: 'hi' },
        helpers: r._helpers,
        templates: r._templates,
        maxIncludeDepth: r._maxIncludeDepth,
        selector: parseSelector('#s'),
    });
    assert.equal(out, '<span id="s">HI</span>');
});

test('fragment: runtime error inside the matched subtree surfaces as ReflowRuntimeError', async () => {
    const r = await setup({
        page: `<div><p id="p" x-text=".missing.field"></p></div>`,
    });
    assert.throws(
        () => fragment(r, 'page', '#p'),
        (e) => e instanceof ReflowRuntimeError
    );
});
