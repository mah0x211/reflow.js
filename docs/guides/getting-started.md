# Getting started

Install the package, register a template, and render it.

## Install

```sh
npm install @mah0x211/reflow
```

Node.js **24 or newer** is required. The package works unchanged on Cloudflare Workers — the `workerd` export condition selects the native `HTMLRewriter` adapter and excludes `html-rewriter-wasm` from the Worker bundle.

## Your first template

Reflow templates are plain HTML with `x-*` attributes. Compile them once, then render as many times as you like.

```js
import { Reflow } from '@mah0x211/reflow';

const reflow = new Reflow({
  helpers: {
    upper: (s) => String(s).toUpperCase(),
  },
});

await reflow.compile('greeting', `
  <section x-data="user: { name: 'Ada' }">
    <h1 x-text="upper(@user.name)"></h1>
    <ul>
      <li x-each="hobby in $.hobbies" x-text=".hobby"></li>
    </ul>
  </section>
`);

const html = reflow.render('greeting', { hobbies: ['coding', 'reading'] });
// → <section><h1>ADA</h1><ul><li>coding</li><li>reading</li></ul></section>
```

### What just happened

- `compile()` parses the HTML once. The resulting IR is cached on the instance.
- `render()` walks the IR synchronously against `data` (exposed as `$`) and returns a string.
- `x-data="user: {...}"` declares a compile-time named scope reachable as `@user`. Its runtime-evaluated counterpart is [`x-with`](../template/directives/x-with.md).
- `x-text` replaces the element's body with the escaped expression value.
- `x-each` iterates an array; `.hobby` refers to the current loop item.
- `upper` is a helper — a synchronous function the instance was constructed with. Helpers are the only way to run arbitrary JavaScript in an expression; the expression language itself does not allow arithmetic, method calls, or template literals.

## Serving a request

The most common pattern is: create one `Reflow` instance at startup, compile every template once, then reuse it for every request.

```js
import { Reflow } from '@mah0x211/reflow';
import http from 'node:http';
import fs from 'node:fs/promises';

const reflow = new Reflow({
  loader: (path) => fs.readFile(path, 'utf-8'),
  helpers: { upper: (s) => String(s).toUpperCase() },
});

await reflow.compileFile('layout', './views/layout.html');
await reflow.compileFile('home',   './views/home.html');

http.createServer(async (req, res) => {
  const html = reflow.render('layout', {
    title: 'Home',
    content: 'home',
    user: await getUser(req),
  });
  res.writeHead(200, { 'content-type': 'text/html; charset=UTF-8' });
  res.end(html);
}).listen(3000);
```

The static `Reflow.render(html, data, config)` shortcut compiles on every call and is only appropriate for CLIs, tests, and one-off pages.

## Handling errors

Every error is a subclass of `ReflowError` and carries source location metadata.

```js
try {
  await reflow.compile('bad', '<div x-else></div>');
} catch (err) {
  console.error(err.name);            // ReflowCompileError
  console.error(err.message);         // x-else has no preceding x-if / x-elseif
  console.error(err.line, err.column);// 1, 6
  console.error(err.snippet);         // multi-line source with a caret
}
```

See the [API reference](../api.md#error-hierarchy) for the full metadata schema and every `reason` code.

## Next steps

- [Fragment rendering](./fragment-rendering.md) — serve HTMX / Turbo Frame partials by pointing a CSS selector at your template.
- [Template composition](./template-composition.md) — assemble layouts with `x-include`.
- [Template syntax overview](../template/README.md) — the full directive and expression reference.
- [Performance and memory](./performance.md) — measured footprints and complexity notes.
