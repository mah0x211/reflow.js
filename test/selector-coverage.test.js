import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow, ReflowSelectorError, ReflowIncludeError, ReflowRuntimeError } from '../src/index.js';
import { parseSelector } from '../src/selector/parse.js';
import { renderFragment } from '../src/interpret.js';
import { matchCompound } from '../src/selector/match.js';
import { resolveSelector } from '../src/selector/resolve.js';

async function setup(templates) {
    const r = new Reflow();
    for (const [name, html] of Object.entries(templates)) {
        await r.compile(name, html);
    }
    return r;
}

function fragment(reflow, name, selectorSource, data = {}, maxIncludeDepth) {
    const compiled = reflow._templates.get(name);
    return renderFragment({
        name,
        compiled,
        data,
        helpers: reflow._helpers,
        templates: reflow._templates,
        maxIncludeDepth: maxIncludeDepth ?? reflow._maxIncludeDepth,
        selector: parseSelector(selectorSource),
    });
}

// ---------------------------------------------------------------------------
// Parser edge cases
// ---------------------------------------------------------------------------

test('parse: "." followed by non-ident is rejected', () => {
    assert.throws(() => parseSelector('div.'), (e) => e.reason === 'syntax');
    assert.throws(() => parseSelector('div. '), (e) => e.reason === 'syntax');
});

test('parse: attribute selector missing operator or "]" is rejected', () => {
    assert.throws(() => parseSelector('[a b]'), (e) => e.reason === 'syntax');
    assert.throws(() => parseSelector('[a  '), (e) => e.reason === 'syntax');
});

test('parse: ":" followed by non-ident is rejected', () => {
    assert.throws(() => parseSelector('div:'), (e) => e.reason === 'syntax');
    assert.throws(() => parseSelector('div:('), (e) => e.reason === 'syntax');
});

test('parse: string escape at EOF is rejected', () => {
    assert.throws(() => parseSelector('[a="foo\\'), (e) => e.reason === 'syntax');
});

test('parse: trailing junk after a valid selector is rejected with "unexpected"', () => {
    assert.throws(() => parseSelector('a)'), (e) => {
        assert.equal(e.reason, 'syntax');
        assert.match(e.message, /unexpected/);
        return true;
    });
});

test('parse: bare "#" without an identifier is rejected', () => {
    assert.throws(() => parseSelector('#'), (e) => {
        assert.equal(e.reason, 'syntax');
        assert.match(e.message, /identifier after "#"/);
        return true;
    });
});

// ---------------------------------------------------------------------------
// match.js branches
// ---------------------------------------------------------------------------

test('matchCompound: id compound rejects elements without the id', () => {
    const el = { tagName: 'div', attrs: [['class', 'x']] };
    const compound = parseSelector('.x#missing').selectors[0].parts[0].compound;
    assert.equal(matchCompound(el, compound), false);
});

test('matchCompound: multiple-class compound rejects missing class', () => {
    const el = { tagName: 'div', attrs: [['class', 'a']] };
    const compound = parseSelector('.a.b').selectors[0].parts[0].compound;
    assert.equal(matchCompound(el, compound), false);
});

test('matchCompound: attribute with op rejects elements missing the attribute', () => {
    const el = { tagName: 'div', attrs: [] };
    const compound = parseSelector('[data-x="v"]').selectors[0].parts[0].compound;
    assert.equal(matchCompound(el, compound), false);
});

test('matchCompound: attribute "=" exact match', () => {
    const el = { tagName: 'div', attrs: [['data-x', 'v']] };
    const compound = parseSelector('[data-x=v]').selectors[0].parts[0].compound;
    assert.equal(matchCompound(el, compound), true);
});

test('matchCompound: attribute "~=" rejects when target contains whitespace or is empty', () => {
    const el = { tagName: 'div', attrs: [['data-x', 'a b c']] };
    // target with whitespace — invalid per CSS spec, returns false
    const compound = parseSelector('[data-x~="a b"]').selectors[0].parts[0].compound;
    assert.equal(matchCompound(el, compound), false);
});

// ---------------------------------------------------------------------------
// resolve.js branches
// ---------------------------------------------------------------------------

test('resolve: descendant combinator returns empty when no ancestor matches', async () => {
    const r = await setup({ t: '<div><section><p>x</p></section></div>' });
    // .missing p — no ancestor .missing exists
    const cand = resolveSelector(r._templates.get('t').index, parseSelector('.missing p'));
    assert.equal(cand.length, 0);
});

// ---------------------------------------------------------------------------
// index.js: multiple-space class attribute
// ---------------------------------------------------------------------------

test('index: multi-space class attribute drops empty tokens', async () => {
    const r = await setup({ t: '<div class="  a   b  "></div>' });
    const idx = r._templates.get('t').index;
    assert.deepEqual([...idx.byClass.keys()].sort(), ['a', 'b']);
});

// ---------------------------------------------------------------------------
// interpret.js: root-level positional candidate
// ---------------------------------------------------------------------------

test('fragment: root-level positional candidate (parent === null)', async () => {
    const r = await setup({ t: '<div id="a"></div><span id="b"></span><p id="c"></p>' });
    // The three top-level elements are children of root, no wrapping parent.
    assert.equal(fragment(r, 't', 'div:first-child'), '<div id="a"></div>');
    assert.equal(fragment(r, 't', 'p:last-child'), '<p id="c"></p>');
});

// ---------------------------------------------------------------------------
// interpret.js: parent with x-data / x-for / x-each in positional path
// ---------------------------------------------------------------------------

test('fragment: positional selector inside parent with x-data', async () => {
    const r = await setup({
        t: `
            <div id="wrap" x-data="page: { title: 'T' }">
                <span x-text="@page.title">a</span>
                <span>b</span>
            </div>
        `,
    });
    assert.equal(fragment(r, 't', '#wrap > span:first-child'), '<span>T</span>');
});

test('fragment: positional selector with parent x-for', async () => {
    const r = await setup({
        t: `
            <div x-for="i = 1, 1">
                <span class="a" x-text=".i"></span>
                <span class="b">tail</span>
            </div>
        `,
    });
    assert.equal(fragment(r, 't', 'span.a:first-child'), '<span class="a">1</span>');
});

test('fragment: positional selector with parent x-each', async () => {
    const r = await setup({
        t: `
            <ul x-each="row in $.rows">
                <li class="head" x-text=".row.h"></li>
                <li class="body" x-text=".row.b"></li>
            </ul>
        `,
    });
    assert.equal(
        fragment(r, 't', 'li.body:last-child', { rows: [{ h: 'H', b: 'B' }] }),
        '<li class="body">B</li>'
    );
});

// ---------------------------------------------------------------------------
// interpret.js: sibling directives inside the tracked walk
// ---------------------------------------------------------------------------

test('fragment: positional walk skips text/comment siblings', async () => {
    const r = await setup({
        t: `<ul> <!--c--> <li class="target">x</li> <!--tail--> </ul>`,
    });
    assert.equal(fragment(r, 't', 'li:first-child'), '<li class="target">x</li>');
});

test('fragment: positional walk counts chain sibling as 1 or 0 based on cond', async () => {
    const r = await setup({
        t: `
            <ul>
                <li x-if="$.show">optional</li>
                <li class="tgt">target</li>
            </ul>
        `,
    });
    // show=true: sibling emissions = [optional, target]; tgt is at position 2
    assert.equal(fragment(r, 't', 'li.tgt:nth-child(2)', { show: true }), '<li class="tgt">target</li>');
    // show=false: sibling emissions = [target]; tgt is at position 1
    assert.equal(fragment(r, 't', 'li.tgt:first-child', { show: false }), '<li class="tgt">target</li>');
});

test('fragment: positional walk counts x-each sibling by iteration count', async () => {
    const r = await setup({
        t: `
            <ul>
                <li x-each="u in $.users">u</li>
                <li class="tail">tail</li>
            </ul>
        `,
    });
    // 3 users → tail is at nth-child(4)
    assert.equal(
        fragment(r, 't', 'li.tail:nth-child(4)', { users: ['a', 'b', 'c'] }),
        '<li class="tail">tail</li>'
    );
});

test('fragment: positional walk counts x-for sibling by iteration count', async () => {
    const r = await setup({
        t: `
            <ul>
                <li x-for="i = 1, 3">i</li>
                <li class="tail">tail</li>
            </ul>
        `,
    });
    assert.equal(fragment(r, 't', 'li.tail:nth-child(4)'), '<li class="tail">tail</li>');
});

test('fragment: positional walk rejects x-each collection that is not an array', async () => {
    const r = await setup({
        t: `
            <ul>
                <li x-each="u in $.users">u</li>
                <li class="tail">tail</li>
            </ul>
        `,
    });
    assert.throws(
        () => fragment(r, 't', 'li.tail:nth-child(2)', { users: 'not-an-array' }),
        (e) => e instanceof ReflowRuntimeError
    );
});

// ---------------------------------------------------------------------------
// interpret.js: stepControlFlow x-for / x-each on ancestor (targeted walk)
// ---------------------------------------------------------------------------

test('fragment: targeted walk through ancestor x-for iterates', async () => {
    const r = await setup({
        t: `
            <div x-for="i = 1, 1">
                <span id="x">value</span>
            </div>
        `,
    });
    assert.equal(fragment(r, 't', '#x'), '<span id="x">value</span>');
});

test('fragment: targeted walk through ancestor x-each with rejected non-array collection', async () => {
    const r = await setup({
        t: `
            <ul x-each="u in $.users">
                <li id="target">v</li>
            </ul>
        `,
    });
    assert.throws(
        () => fragment(r, 't', '#target', { users: 'not-an-array' }),
        (e) => e instanceof ReflowRuntimeError
    );
});

// ---------------------------------------------------------------------------
// interpret.js: include search error paths
// ---------------------------------------------------------------------------

test('fragment: cross-include propagates invalid include expression', async () => {
    const r = await setup({
        layout: `<div><main x-include="$.bad"></main></div>`,
    });
    assert.throws(
        () => fragment(r, 'layout', '#anything', { bad: 42 }),
        (e) => e instanceof ReflowIncludeError && e.reason === 'invalid'
    );
});

test('fragment: cross-include propagates depth exceeded', async () => {
    const r = await setup({
        // Chain of includes: a -> b -> c -> d — 4 templates, depth limit set to 2
        a: `<div><main x-include="'b'"></main></div>`,
        b: `<div><main x-include="'c'"></main></div>`,
        c: `<div><main x-include="'d'"></main></div>`,
        d: `<div id="ok">hi</div>`,
    });
    // Set a low maxIncludeDepth to trigger the limit before we reach d.
    assert.throws(
        () => fragment(r, 'a', '#ok', {}, /*maxIncludeDepth=*/2),
        (e) => e instanceof ReflowIncludeError && e.reason === 'depth_exceeded'
    );
});

// ---------------------------------------------------------------------------
// interpret.js: positional predicate with x-match parent + non-target case
// ---------------------------------------------------------------------------

test('fragment: positional pseudo on x-match child selects only when matching case is target', async () => {
    const r = await setup({
        t: `
            <div x-match="$.k">
                <section x-case="'a'">A</section>
                <section x-case="'b'">B</section>
            </div>
        `,
    });
    // Static candidates: both sections. Positional :first-of-type applies to
    // section tag; runtime only one section renders. When k='b', the emitted
    // section is B, which is of-type index 1 among sections → match.
    assert.equal(fragment(r, 't', 'section:first-of-type', { k: 'b' }), '<section>B</section>');
});

test('fragment: positional pseudo on x-match child with no case selected is no_match', async () => {
    const r = await setup({
        t: `
            <div x-match="$.k">
                <section x-case="'a'">A</section>
            </div>
        `,
    });
    assert.throws(
        () => fragment(r, 't', 'section:first-of-type', { k: 'other' }),
        (e) => e.reason === 'no_match'
    );
});

// ---------------------------------------------------------------------------
// interpret.js: candidate with x-break subtree
// ---------------------------------------------------------------------------

test('fragment: candidate is x-each element with x-break-if inside', async () => {
    const r = await setup({
        t: `
            <ul id="list">
                <li x-each="u in $.users" x-text=".u">
                    <span x-break-if="true"></span>
                </li>
            </ul>
        `,
    });
    // 1 user → single fragment.
    assert.equal(
        fragment(r, 't', '#list > li', { users: ['only'] }),
        '<li>only</li>'
    );
});

// ---------------------------------------------------------------------------
// resolve.js: selector list matches the same element multiple times
// ---------------------------------------------------------------------------

test('resolve: selector list matches same element only once', async () => {
    const r = await setup({ t: '<div id="x" class="a"></div>' });
    const cand = resolveSelector(r._templates.get('t').index, parseSelector('#x, .a'));
    assert.equal(cand.length, 1);
});

// ---------------------------------------------------------------------------
// interpret.js: direct-path candidate with own x-for / x-each iteration
// ---------------------------------------------------------------------------

test('fragment: direct-path candidate with own x-for iterating once', async () => {
    const r = await setup({
        t: `
            <div>
                <span id="tag" x-for="i = 5, 5" x-text=".i"></span>
            </div>
        `,
    });
    // x-for iterates once (5..5) → 1 emission
    assert.equal(fragment(r, 't', '#tag'), '<span id="tag">5</span>');
});

test('fragment: direct-path candidate x-for with multiple iterations is multi-match', async () => {
    const r = await setup({
        t: `<div><span class="t" x-for="i = 1, 3"></span></div>`,
    });
    assert.throws(
        () => fragment(r, 't', '.t'),
        (e) => e.reason === 'multiple_matches'
    );
});

test('fragment: direct-path candidate x-each with 0 items is no_match', async () => {
    const r = await setup({
        t: `<div><span class="t" x-each="u in $.us"></span></div>`,
    });
    assert.throws(
        () => fragment(r, 't', '.t', { us: [] }),
        (e) => e.reason === 'no_match'
    );
});

// ---------------------------------------------------------------------------
// interpret.js: positional walk where the sibling that IS the target has
// its own x-for / x-each (exercises the "isTarget && iteration" branch).
// ---------------------------------------------------------------------------

test('fragment: positional walk with target having x-each and single iteration', async () => {
    const r = await setup({
        t: `
            <ul>
                <li class="t" x-each="u in $.us" x-text=".u"></li>
                <li>tail</li>
            </ul>
        `,
    });
    // 1 user → 1 emission of the .t; :first-child matches.
    assert.equal(
        fragment(r, 't', '.t:first-child', { us: ['x'] }),
        '<li class="t">x</li>'
    );
});

test('fragment: positional walk with target having x-for iterating once', async () => {
    const r = await setup({
        t: `
            <ul>
                <li class="t" x-for="i = 7, 7" x-text=".i"></li>
                <li>tail</li>
            </ul>
        `,
    });
    assert.equal(fragment(r, 't', '.t:first-child'), '<li class="t">7</li>');
});

// ---------------------------------------------------------------------------
// interpret.js: parent x-each with non-array collection in positional path
// ---------------------------------------------------------------------------

test('fragment: positional parent x-each rejects non-array collection', async () => {
    const r = await setup({
        t: `
            <ul x-each="u in $.us">
                <li class="t">x</li>
            </ul>
        `,
    });
    assert.throws(
        () => fragment(r, 't', 'li.t:first-child', { us: 'not-an-array' }),
        (e) => e instanceof ReflowRuntimeError
    );
});

// ---------------------------------------------------------------------------
// checkOwnBranch: matchBranch where target's case is not the selected one
// ---------------------------------------------------------------------------

test('fragment: candidate is a non-selected x-case (checkOwnBranch matchBranch false)', async () => {
    const r = await setup({
        t: `
            <div x-match="$.k">
                <section id="a" x-case="'a'">A</section>
                <section id="b" x-case="'b'">B</section>
            </div>
        `,
    });
    // Selector matches #b directly; when k='a', b's case is not selected → no_match
    assert.throws(
        () => fragment(r, 't', '#b', { k: 'a' }),
        (e) => e.reason === 'no_match'
    );
});

// ---------------------------------------------------------------------------
// interpret.js: BreakSignal handling in renderIterationsCapturing
// ---------------------------------------------------------------------------

test('fragment: direct-path x-for candidate: break-if in body cuts further iterations', async () => {
    const r = await setup({
        t: `<ul id="tag" x-for="i = 1, 3"><li class="row" x-break-if=".i == 2">i</li></ul>`,
    });
    // Iteration i=1 emits successfully (single-fragment success), iteration
    // i=2 triggers break-if which unwinds the loop. Only 1 match survives.
    assert.equal(
        fragment(r, 't', '#tag'),
        '<ul id="tag"><li class="row">i</li></ul>'
    );
});

test('fragment: direct-path x-each candidate: break-if in body cuts further iterations', async () => {
    const r = await setup({
        t: `<ul id="tag" x-each="u in $.us"><li class="row" x-break-if=".u == 'stop'" x-text=".u"></li></ul>`,
    });
    // Only iteration u='ok' completes successfully; u='stop' triggers break.
    assert.equal(
        fragment(r, 't', '#tag', { us: ['ok', 'stop', 'never-reached'] }),
        '<ul id="tag"><li class="row">ok</li></ul>'
    );
});

// ---------------------------------------------------------------------------
// interpret.js: stepControlFlow ancestor chain / match / iteration branches
// ---------------------------------------------------------------------------

test('fragment: targeted walk through ancestor x-if (chainBranch)', async () => {
    const r = await setup({
        t: `
            <div>
                <section x-if="$.show">
                    <span id="target">v</span>
                </section>
            </div>
        `,
    });
    assert.equal(fragment(r, 't', '#target', { show: true }), '<span id="target">v</span>');
    assert.throws(
        () => fragment(r, 't', '#target', { show: false }),
        (e) => e.reason === 'no_match'
    );
});

test('fragment: targeted walk through ancestor x-else branch', async () => {
    const r = await setup({
        t: `
            <div>
                <section x-if="$.show"><span id="a">A</span></section>
                <section x-else><span id="b">B</span></section>
            </div>
        `,
    });
    // Ancestor of #b is the else branch — reachable when show=false.
    assert.equal(fragment(r, 't', '#b', { show: false }), '<span id="b">B</span>');
    // Not reachable when show=true.
    assert.throws(
        () => fragment(r, 't', '#b', { show: true }),
        (e) => e.reason === 'no_match'
    );
});

test('fragment: targeted walk through ancestor x-match / x-case', async () => {
    const r = await setup({
        t: `
            <div x-match="$.k">
                <section x-case="'a'"><span id="ax">A</span></section>
                <section x-case="'b'"><span id="bx">B</span></section>
            </div>
        `,
    });
    // Ancestor of #ax is the 'a' case; reachable only when k='a'.
    assert.equal(fragment(r, 't', '#ax', { k: 'a' }), '<span id="ax">A</span>');
    assert.throws(
        () => fragment(r, 't', '#ax', { k: 'b' }),
        (e) => e.reason === 'no_match'
    );
});

test('fragment: targeted walk through ancestor x-each iterating once', async () => {
    const r = await setup({
        t: `
            <ul x-each="u in $.us">
                <li id="target" x-text=".u"></li>
            </ul>
        `,
    });
    // 1 iteration → 1 match.
    assert.equal(fragment(r, 't', '#target', { us: ['only'] }), '<li id="target">only</li>');
});

test('fragment: targeted walk through ancestor x-each with zero iterations', async () => {
    const r = await setup({
        t: `
            <ul x-each="u in $.us">
                <li id="target"></li>
            </ul>
        `,
    });
    assert.throws(
        () => fragment(r, 't', '#target', { us: [] }),
        (e) => e.reason === 'no_match'
    );
});

// ---------------------------------------------------------------------------
// interpret.js: further edge cases uncovered by earlier tests
// ---------------------------------------------------------------------------

test('fragment: checkOwnBranch matchBranch returns false when no case matches', async () => {
    const r = await setup({
        t: `
            <div x-match="$.k">
                <section id="a" x-case="'a'">A</section>
            </div>
        `,
    });
    // k='other' → no case selected, no nocase fallback. #a's own branch
    // is not selected → no_match.
    assert.throws(
        () => fragment(r, 't', '#a', { k: 'other' }),
        (e) => e.reason === 'no_match'
    );
});

test('fragment: direct-path x-each candidate rejects non-array collection', async () => {
    const r = await setup({
        t: `<ul id="tag" x-each="u in $.us"><li class="row" x-text=".u"></li></ul>`,
    });
    assert.throws(
        () => fragment(r, 't', '#tag', { us: 'not-array' }),
        (e) => e instanceof ReflowRuntimeError
    );
});

test('fragment: direct-path x-for candidate rethrows non-BreakSignal errors', async () => {
    // Force a runtime TypeError via property access on undefined inside a
    // loop body. The interpreter wraps this as ReflowRuntimeError, which is
    // not a BreakSignal and so hits the rethrow path in
    // renderIterationsCapturing.
    const r = await setup({
        t: `<ul id="tag" x-for="i = 1, 3"><li class="row" x-text=".none.name"></li></ul>`,
    });
    assert.throws(
        () => fragment(r, 't', '#tag'),
        (e) => e instanceof ReflowRuntimeError
    );
});

test('fragment: direct-path x-each candidate rethrows non-BreakSignal errors', async () => {
    const r = await setup({
        t: `<ul id="tag" x-each="u in $.us"><li class="row" x-text=".none.name"></li></ul>`,
    });
    assert.throws(
        () => fragment(r, 't', '#tag', { us: ['x'] }),
        (e) => e instanceof ReflowRuntimeError
    );
});

// ---------------------------------------------------------------------------
// interpret.js: BreakSignal handling in positional emitOneOrLoop
// ---------------------------------------------------------------------------

test('fragment: positional walk with target x-for that hits BreakSignal in body', async () => {
    const r = await setup({
        t: `<div><ul class="tgt" x-for="i = 1, 5"><li class="row" x-break-if=".i == 2">i</li></ul></div>`,
    });
    // :first-of-type does not early-terminate, so the walk enters iteration
    // i=1 (records emission at ofTypeIndex 1), then iteration i=2 which
    // throws BreakSignal from the li's x-break-if — exercising the
    // BreakSignal branch of emitOneOrLoop's x-for isTarget path. The
    // recorded emission at ofTypeIndex 1 still matches :first-of-type.
    assert.equal(
        fragment(r, 't', '.tgt:first-of-type'),
        '<ul class="tgt"><li class="row">i</li></ul>'
    );
});

test('fragment: positional walk with target x-each that hits BreakSignal in body', async () => {
    const r = await setup({
        t: `<div><ul class="tgt" x-each="u in $.us"><li class="row" x-break-if=".u == 'stop'" x-text=".u"></li></ul></div>`,
    });
    assert.equal(
        fragment(r, 't', '.tgt:first-of-type', { us: ['ok', 'stop', 'ignored'] }),
        '<ul class="tgt"><li class="row">ok</li></ul>'
    );
});

test('fragment: positional walk with target x-for rethrows non-BreakSignal', async () => {
    const r = await setup({
        t: `<div><ul class="tgt" x-for="i = 1, 3"><li class="row" x-text=".none.name"></li></ul></div>`,
    });
    assert.throws(
        () => fragment(r, 't', '.tgt:first-child'),
        (e) => e instanceof ReflowRuntimeError
    );
});

test('fragment: positional walk with target x-each rethrows non-BreakSignal', async () => {
    const r = await setup({
        t: `<div><ul class="tgt" x-each="u in $.us"><li class="row" x-text=".none.name"></li></ul></div>`,
    });
    assert.throws(
        () => fragment(r, 't', '.tgt:first-child', { us: ['x'] }),
        (e) => e instanceof ReflowRuntimeError
    );
});

test('fragment: targeted walk through ancestor x-nocase branch (matchBranch cond=null)', async () => {
    const r = await setup({
        t: `
            <div x-match="$.k">
                <section x-case="'a'"><span id="ax">A</span></section>
                <section x-nocase><span id="fallback">F</span></section>
            </div>
        `,
    });
    // #fallback lives under x-nocase; when k is 'x', all cases fail and
    // nocase is selected → x-nocase's matchBranch.cond === null → the
    // "selected = true" branch of stepControlFlow's matchBranch loop fires.
    assert.equal(fragment(r, 't', '#fallback', { k: 'x' }), '<span id="fallback">F</span>');
});

// ---------------------------------------------------------------------------
// interpret.js: stopAfter early exit in loop paths
// ---------------------------------------------------------------------------

test('fragment: direct-path x-each guard exits once enough matches are captured', async () => {
    const r = await setup({
        t: `<ul id="tag" x-each="u in $.us" x-text=".u"></ul>`,
    });
    // 3 iterations → 3 emissions. The guard (matches.length >= stopAfter)
    // fires at the third iteration, exiting early with 2 matches; finalize
    // then throws multiple_matches.
    assert.throws(
        () => fragment(r, 't', '#tag', { us: ['a', 'b', 'c'] }),
        (e) => e.reason === 'multiple_matches'
    );
});

test('fragment: targeted walk through ancestor x-for guard exits once enough matches', async () => {
    const r = await setup({
        t: `<div x-for="i = 1, 3"><span id="target" x-text=".i"></span></div>`,
    });
    // Three iterations of the div — each produces one #target emission.
    // The guard in stepControlFlow's x-for path fires after two matches.
    assert.throws(
        () => fragment(r, 't', '#target'),
        (e) => e.reason === 'multiple_matches'
    );
});

test('fragment: targeted walk through ancestor x-each guard exits once enough matches', async () => {
    const r = await setup({
        t: `<div x-each="u in $.us"><span id="target" x-text=".u"></span></div>`,
    });
    assert.throws(
        () => fragment(r, 't', '#target', { us: ['a', 'b', 'c'] }),
        (e) => e.reason === 'multiple_matches'
    );
});
