# Template composition

Reflow templates can host other compiled templates via the `x-include` directive. This is how you build layouts, share reusable panels, and split a large page into meaningful units without a bundler or preprocessor step.

## The basic pattern

Compile each unit independently, then let one template call the others by name:

```js
const reflow = new Reflow();

await reflow.compile('sidebar', await fs.readFile('./views/sidebar.html', 'utf-8'));
await reflow.compile('feed',    await fs.readFile('./views/feed.html',    'utf-8'));
await reflow.compile('layout',  await fs.readFile('./views/layout.html',  'utf-8'));

const html = reflow.render('layout', {
  title: 'Home',
  user: currentUser,
  items: await db.recent(),
});
```

```html
<!-- views/layout.html -->
<html>
  <head><title x-text="$.title"></title></head>
  <body>
    <aside x-include="'sidebar'"></aside>
    <main x-include="'feed'"></main>
  </body>
</html>
```

`x-include="'sidebar'"` is an expression: the string literal `'sidebar'` evaluates to the template name. Any expression that yields a template name works — a global, a helper call, or an `x-data` reference — which is what makes dynamic content areas possible (see below).

## Scope across include boundaries

Includes are **not** transclusion. The included template renders in its own lexical scope: **globals (`$`) are inherited, but the parent's `x-data`, `x-for`, and `x-each` variables are not**.

That means the sidebar sees `$.user`, but if the layout also declares `x-data="site: {...}"`, the sidebar cannot reach `@site` — it would need its own `x-data` (which the layout can seed via globals) or receive the value through `$`.

```html
<!-- layout: exposes @site to itself only -->
<body x-data="site: { name: $.siteName }">
  <header>
    <span x-text="@site.name"></span>            <!-- ok -->
  </header>
  <main x-include="'feed'"></main>               <!-- @site not visible inside feed -->
</body>

<!-- feed: reaches through globals instead -->
<section>
  <h1 x-text="$.siteName"></h1>
</section>
```

If you catch yourself wanting to pass complex context in, put it in `$` before rendering. Reflow deliberately draws a hard boundary so that includes are always composable — you never need to know what scopes the parent happens to declare.

## Dynamic content areas

Since `x-include` takes an expression, one layout can host any content template chosen at render time:

```html
<!-- views/layout.html -->
<html>
  <body>
    <header>...</header>
    <main x-include="$.content"></main>
    <footer>...</footer>
  </body>
</html>
```

```js
await reflow.compile('layout',    layoutHtml);
await reflow.compile('user_page', userPageHtml);
await reflow.compile('post_page', postPageHtml);

reflow.render('layout', { content: 'user_page', ...userData });
reflow.render('layout', { content: 'post_page', ...postData });
```

Combined with fragment rendering (see the [fragment guide](./fragment-rendering.md)), this is enough to build HTMX-style applications where each URL renders the layout on the initial request and just the relevant subtree on subsequent partial requests.

## Nested includes

Includes can include other includes. There is no depth limit imposed by the language, only by `config.maxIncludeDepth` (default 50) which guards against accidental recursion.

```
layout ──> feed ──> feed_item ──> user_badge
```

Every include is resolved fresh — the interpreter tracks an include stack and refuses to re-enter a template that is already on it (`ReflowIncludeError { reason: 'cycle' }`). This makes recursion an explicit, guarded operation rather than an accidental one.

## Handling include failures

Every fault surfaces as `ReflowIncludeError` with a `reason`:

| `reason` | Trigger |
|---|---|
| `'invalid'` | The include expression did not evaluate to a string. |
| `'not_found'` | The named template is not registered on the instance. |
| `'cycle'` | Same template re-entered while already on the include stack. |
| `'depth_exceeded'` | Include stack length reached `maxIncludeDepth`. |

The error carries `includeStack: string[]`, giving you the exact chain of templates leading to the failure — invaluable when a partial fails and the entry point is several includes away.

```js
try {
  reflow.render('layout', data);
} catch (err) {
  if (err instanceof ReflowIncludeError && err.reason === 'not_found') {
    console.error(`missing template "${err.requested}" via ${err.includeStack.join(' → ')}`);
  }
}
```

## Fragment mode and includes

`render(name, data, selector)` searches the entry template first. If it yields at least one static candidate, the include walk is skipped — you get the local match, not a match in a nested content template. Only when the entry template contributes zero candidates does Reflow walk its `x-include` elements and search the included template recursively.

This makes cross-include fragment fetches work naturally:

```js
// entry template has no #post-body; content template does → found in the include
reflow.render('layout', { content: 'post_page', ...data }, '#post-body');
```

...while also keeping "the local one wins" intuition intact:

```js
// entry template has an #alert of its own → that one is returned; includes are not walked
reflow.render('layout', { content: 'post_page', ...data }, '#alert');
```

See the [fragment guide](./fragment-rendering.md#cross-include-search) for the full ruleset and edge cases.

## Hot reload

The instance holds a template cache. To swap a template in place — during development or after a filesystem watch event — call `clear(name)` before recompiling:

```js
watcher.on('change', async (name) => {
  reflow.clear(name);
  await reflow.compileFile(name, `./views/${name}.html`);
});
```

`clear()` with no argument removes every registered template. It returns the list of removed names, useful for logging.
