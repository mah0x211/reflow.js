# reflow.js

[![test](https://github.com/mah0x211/reflow.js/actions/workflows/test.yml/badge.svg)](https://github.com/mah0x211/reflow.js/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@mah0x211/reflow)](https://www.npmjs.com/package/@mah0x211/reflow)
[![codecov](https://codecov.io/github/mah0x211/reflow.js/graph/badge.svg)](https://codecov.io/github/mah0x211/reflow.js)

An attribute-based HTML template engine that renders declarative HTML attributes into HTML. Data binding, conditionals, iteration, and template composition are expressed using directive attributes such as `x-text`, `x-if`, and `x-each`. The directive prefix (`x-` by default) is configurable, allowing templates to coexist with client-side libraries that use the same attribute convention.


## Features

- **Declarative directives** — Data binding, conditionals, iteration, and template composition are expressed through `x-*` attributes (configurable prefix).
- **Renders to plain HTML** — Directives are resolved at render time; the output is plain HTML with no client-side runtime emitted.
- **No `eval` / `new Function`** — A purpose-built expression parser and a fixed IR interpreter replace dynamic code generation.
- **Symbol-based scopes** — Three scope families: `$` (globals), `@name` (a named `x-data`), and `.` (the nearest lexical binding).
- **Fail-fast** — Errors surface at compile or render time with a source snippet, line/column, the reconstructed element, and the include stack.
- **`x-include`** — Compose compiled templates to build layouts.

## Install

```sh
npm install @mah0x211/reflow
```

## Quick start

```js
import { Reflow } from '@mah0x211/reflow';

const reflow = new Reflow({
  helpers: {
    upper: (s) => String(s).toUpperCase(),
    format: (n) => new Intl.NumberFormat('en-US').format(n),
  },
});

await reflow.compile('user_page', `
  <div x-data="page: { title: 'Users' }">
    <h1 x-text="upper(.page.title)"></h1>
    <ul>
      <li x-each="u, i in $.users">
        <span x-text=".i"></span>: <span x-text=".u.name"></span>
      </li>
    </ul>
  </div>
`);

const html = reflow.render('user_page', {
  users: [{ name: 'Alice' }, { name: 'Bob' }],
});
// → <div><h1>USERS</h1><ul><li>0: Alice</li><li>1: Bob</li></ul></div>
```

## Directives

The directive prefix is `x-` by default and configurable via the `prefix` option. Changing it frees the `x-*` namespace for use by other libraries — for example, a client-side framework that also relies on `x-*` attributes.

| Directive | Purpose |
|---|---|
| `x-data="name: {...}"` | Declares one or more named scopes (JSON5; multiple top-level keys allowed). |
| `x-text="expr"` | Replaces the element's text content with the expression result (HTML-escaped). |
| `x-html="expr"` | Replaces the element's content with raw HTML (no escaping). |
| `x-bind:name="expr"` | Sets an attribute. `true` emits a bare attribute; `null`/`undefined`/`false` omit it. |
| `x-if` / `x-elseif` / `x-else` | Conditional branch chain. |
| `x-match` / `x-case` / `x-nocase` | Value-comparison branching (`x-match` on the parent; `x-case`/`x-nocase` on the children). |
| `x-for="i = start, stop[, step]"` | Numeric range iteration (inclusive; negative step allowed; integers only). |
| `x-each="item[, index] in expr"` | Array iteration. |
| `x-break` / `x-break-if="expr"` | Early loop termination. |
| `x-include="expr"` | Embeds another compiled template by name. |

Unknown attributes under the reserved prefix are rejected at compile time. Use `data-*` for custom attributes.

## Scopes

Every expression resolves through one of three symbols. There are no un-prefixed magic variables.

| Symbol | Refers to | Source |
|---|---|---|
| `$` | Globals passed to `render()` | The `data` argument of `render(name, data)`. |
| `@name` | A named `x-data` scope | The matching `x-data="name: {...}"`. |
| `.` | The nearest lexical binding | Any enclosing `x-data`, `x-for`, or `x-each`. |

`@name` searches only `x-data` frames; `.` searches every frame (including loop variables), innermost first. The difference matters when a loop variable shadows a `x-data` scope of the same name: `.` binds to the loop variable, `@` reaches the `x-data`.

```html
<div x-data="user: { name: 'Alice' }">
  <ul>
    <li x-each="user, i in $.users">
      .user.name   <!-- current iteration's user -->
      @user.name   <!-- 'Alice', from x-data -->
    </li>
  </ul>
</div>
```

An included template only inherits `$`; the parent's lexical scope (`x-data`, loop variables) is not visible inside it.

## Expression language

Expressions are intentionally minimal. Allowed:

- **Literals** — strings (`'text'` or `"text"`), numbers (`123`, `3.14`, `-1`), `true`, `false`, `null`
- **Comparisons** — `==`, `!=`, `<`, `>`, `<=`, `>=` (`==` is strict, like JS `===`)
- **Logical** — `!`, `&&`, `||` (short-circuit)
- **Nullish coalescing** — `??`
- **Ternary** — `cond ? then : else`
- **Optional chaining** — `.a?.b?.c`
- **Helper calls** — `name(arg1, arg2, ...)`, where `name` is a helper registered on the `Reflow` instance. Nesting is allowed: `format(upper(.name), 'en')`.

Arithmetic, string concatenation, method calls (`.a.b()`), array/object literals, and template literals are not supported — delegate them to helpers. Prohibiting method calls also makes prototype-pollution escapes via `.constructor` lexically impossible.

Unresolved scope references return `undefined` rather than throwing; accessing a property of `undefined` without `?.` raises a `TypeError`.

## API

```ts
class Reflow {
  constructor(config?: {
    prefix?: string;            // default 'x-'
    helpers?: Record<string, Function>;
    loader?: (path: string) => Promise<string>;
    maxIncludeDepth?: number;   // default 50
  });

  compile(name: string, html: string): Promise<void>;
  compileFile(name: string, pathname: string): Promise<void>;
  render(name: string, data?: object): string;
  clear(name?: string): string[];
  templates(): string[];

  static render(html: string, data?: object, config?: Config): Promise<string>;
  static renderFile(pathname: string, data?: object, config?: Config): Promise<string>;
}
```

- `compile` is async. Registering the same name twice fails fast — call `clear(name)` first to re-register.
- `render` is synchronous, and so are all helpers.
- The static methods are uncached one-shots. For repeated rendering, use an instance.

## Usage with Cloudflare Workers

The package selects a Workers-specific entry automatically via the `workerd` export condition. When bundled with Wrangler (or esbuild run with `--conditions=workerd`), `html-rewriter-wasm` is excluded from the Worker bundle — the native `HTMLRewriter` global is used instead. No special import is needed; the public API is identical on both runtimes.

```js
import { Reflow } from '@mah0x211/reflow';
import layoutHtml from './views/layout.html?raw';
import userPageHtml from './views/user_page.html?raw';

const reflow = new Reflow({ helpers: { /* ... */ } });
let initialized = false;
async function ensureCompiled() {
  if (initialized) return;
  await reflow.compile('layout', layoutHtml);
  await reflow.compile('user_page', userPageHtml);
  initialized = true;
}

export default {
  async fetch(req, env, ctx) {
    await ensureCompiled();
    const html = reflow.render('layout', {
      title: 'Hello',
      content: 'user_page',
      user: await env.DB.getUser(),
    });
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
  },
};
```

## Error handling

```js
import { ReflowCompileError, ReflowRuntimeError, ReflowIncludeError } from '@mah0x211/reflow';

try {
  await reflow.compile('page', html);
} catch (err) {
  if (err instanceof ReflowCompileError) {
    console.error(`[${err.templateName}] ${err.message}`);
    console.error(`at line ${err.line}, col ${err.column}`);
    console.error(err.snippet);
  }
}
```

All errors expose `snippet` (with surrounding context), `line`, `column`, and `element` (the reconstructed open tag). Include errors additionally expose `includeStack` and `reason` (`'not_found'`, `'cycle'`, or `'depth_exceeded'`).

## Development

```sh
npm install          # install dependencies
npm test             # run tests (node:test)
npm run check        # JSDoc type check
npm run build:types  # generate .d.ts into dist/
```

## Versioning

Releases are tagged in git (e.g. `v0.2.0`). The `version` field in `package.json` is held at `0.0.0-dev` in the repository and is set to the tag's version by CI at publish time, so the repository always reflects a development state. See the [releases page](../../releases) for published versions.

## License

MIT
