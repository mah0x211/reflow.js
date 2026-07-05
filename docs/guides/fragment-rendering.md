# Fragment rendering

`render(name, data, selector)` returns the outer HTML of the single element matched by a CSS selector. It is designed for endpoints that serve partial responses — HTMX and Turbo Frames are the canonical use cases — but also works well for tests, e-mail composition, or any workflow that wants "the header only, please".

## Contract: exactly one match

Selector-based rendering enforces a **single-fragment contract**. Anything other than exactly one runtime match is Fail-fast:

- **Zero matches** → `ReflowSelectorError { reason: 'no_match' }`
- **Two or more matches** → `ReflowSelectorError { reason: 'multiple_matches' }`

Design your templates so the intended fragment is uniquely identifiable — usually by an `id` or a `data-*` marker. `x-each` around a candidate produces one match per iteration, so place the anchor outside the loop or use a positional pseudo-class (see below) to disambiguate.

```js
const reflow = new Reflow();
await reflow.compile('page', `
  <div>
    <header id="hdr"><h1 x-text="$.title"></h1></header>
    <ul>
      <li x-each="p in $.posts" class="post">
        <a x-bind:href="$.p.url" x-text="$.p.title"></a>
      </li>
    </ul>
  </div>
`);

reflow.render('page', data, '#hdr');
// → '<header id="hdr"><h1>...</h1></header>'
```

## Supported syntax

Only the constructs that make sense for server-side fragment fetching are accepted; every other CSS construct is rejected up-front (`ReflowSelectorError { reason: 'unsupported' }`).

| Construct | Example | Supported |
|---|---|---|
| Type / universal | `div`, `*` | ✅ |
| ID | `#header` | ✅ |
| Class | `.article` | ✅ |
| Attribute | `[data-x]`, `[href^="https"]`, six operators (`=` `~=` `\|=` `^=` `$=` `*=`) | ✅ |
| Compound | `article#post.body[data-slug]` | ✅ |
| Selector list | `#a, .b, c[d]` | ✅ |
| Descendant combinator | `section article` | ✅ |
| Child combinator | `ul > li` | ✅ |
| Sibling combinators (`+`, `~`) | | ❌ Not supported |
| Column combinator (`\|\|`) | | ❌ Not supported |
| Tree-structural pseudo-classes | `:first-child`, `:last-child`, `:only-child`, `:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-child(n)`, `:nth-last-child(n)`, `:nth-of-type(n)`, `:nth-last-of-type(n)` | ✅ Integer literal only (no `An+B`, `odd`, `even`) |
| Positional pseudo-classes on non-rightmost compound | `#foo:first-child .bar` | ❌ Not supported |
| Other pseudo-classes (`:not`, `:is`, `:where`, `:has`, `:hover`, ...) | | ❌ Not supported |
| Pseudo-elements (`::before`, ...) | | ❌ Not supported |
| Attribute namespaces / case flags | `[ns\|attr]`, `[a="b" i]` | ❌ Not supported |

## Static vs runtime semantics

- **Static structural selectors** (tag / id / class / attribute / combinators) match the attributes **as written in the template source**. Values produced at runtime by `x-bind:*` are not considered — use `data-*` markers when you need selector-visible attributes.
- **Positional pseudo-classes** count **runtime emissions**: an `x-if` branch that renders contributes 1, a false branch contributes 0, and each `x-each` iteration contributes 1.

For example:

```html
<ul x-match="$.status">
  <li>Status:</li>
  <li x-case="'ok'">OK</li>
  <li x-case="'fail'">Fail</li>
  <li><a href="/status">details</a></li>
</ul>
```

`ul li:nth-child(2)` returns `<li>OK</li>` or `<li>Fail</li>` depending on `$.status`, because only one case is rendered at runtime.

## HTMX scenario

Serve the full page on the initial request and just the changed fragment on subsequent HTMX requests. One template, two endpoints.

```js
import express from 'express';
import { Reflow } from '@mah0x211/reflow';

const reflow = new Reflow();
await reflow.compile('todos', await fs.readFile('./views/todos.html', 'utf-8'));
const LIST = Reflow.compileSelector('#todo-list');

const app = express();

// Initial page load — full document.
app.get('/', async (_, res) => {
  res.send(reflow.render('todos', { items: await db.list() }));
});

// HTMX partial — just the list subtree.
app.post('/todos', express.urlencoded({ extended: false }), async (req, res) => {
  await db.add(req.body.text);
  res.send(reflow.render('todos', { items: await db.list() }, LIST));
});
```

```html
<!-- views/todos.html -->
<div>
  <form hx-post="/todos" hx-target="#todo-list" hx-swap="outerHTML">
    <input name="text" required>
    <button>Add</button>
  </form>

  <ul id="todo-list">
    <li x-each="t in $.items" x-text=".t.text"></li>
  </ul>
</div>
```

## Cross-include search

When the current template contributes zero static candidates, Reflow walks each `x-include` element, executes it, and searches the included template recursively. This lets a layout host a selector that lives in a content template:

```js
await reflow.compile('layout', `
  <html><body>
    <header>...</header>
    <main x-include="$.content"></main>
  </body></html>
`);

await reflow.compile('user_page', `
  <section>
    <div id="user-list"><ul>...</ul></div>
  </section>
`);

reflow.render('layout', { content: 'user_page', ...data }, '#user-list');
// → '<div id="user-list">...</div>'
```

If the current template already has candidates, the include walk is skipped — Reflow does not "keep searching" once a hit exists.

Include-side errors (`invalid`, `not_found`, `cycle`, `depth_exceeded`) fire under the same conditions as full-document rendering, so a broken cross-include target reachable from the search path surfaces as `ReflowIncludeError` even in fragment mode.

## Pre-compiling selectors

Selector strings passed to `render` are memoised in a per-instance LRU (`selectorCacheSize`, default 128). Invalid selectors are never cached, so pathological input cannot bloat memory. For zero-parse hot paths, compile once and reuse — the returned `CompiledSelector` is frozen and safe to share across instances, workers, and requests:

```js
const HEADER = Reflow.compileSelector('#header');
app.get('/header', (_, res) => res.send(reflow.render('page', data, HEADER)));
```

## Performance notes

- Static-only selectors (`#id`, `.class`, `tag`, `#foo .bar`) hit a targeted-walk fast path and skip unrelated subtrees entirely. On the dashboard fixture (`bench/templates/dashboard.html`, ~100 KB rendered) a `title` fragment costs about **1 µs** versus **1.4 ms** for the full render.
- Positional pseudo-classes share a single walk across every candidate that has the same parent; non-target siblings are *counted* (not fully rendered) by consulting their control-flow directives. `:first-child` and `:nth-child(n)` also terminate the sibling walk once the required position has been visited. On the same fixture, `.main-content > section:first-child` runs in **~340 µs** — about 4x faster than the full render.

See [Performance and memory](./performance.md) for the full table and how to interpret the numbers.
