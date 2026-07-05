# API reference

The public surface is the `Reflow` class plus four error classes. Everything else in `src/` is internal and may change without notice. All methods and options are typed by JSDoc; the shapes below reflect the generated `.d.ts`.

## Import

```js
import {
  Reflow,
  ReflowError,
  ReflowCompileError,
  ReflowRuntimeError,
  ReflowIncludeError,
  ReflowSelectorError,
} from '@mah0x211/reflow';
```

The Cloudflare Workers entry (`workerd` export condition) is picked automatically by bundlers; the surface is identical.

## `class Reflow`

### `new Reflow(config?)`

```ts
type Config = {
  prefix?: string;                                 // default 'x-'
  helpers?: Record<string, Function>;
  loader?: (pathname: string) => Promise<string>;
  maxIncludeDepth?: number;                        // default 50
  selectorCacheSize?: number;                      // default 128 (0 disables)
};
```

- `prefix` — the directive prefix. Changing it (for example to `data-x-`) frees the `x-*` attribute namespace for other libraries.
- `helpers` — synchronous functions callable from expressions. The set is frozen at construction; referencing an unregistered name is Fail-fast at compile time.
- `loader` — file-loading hook required only by `compileFile` / `renderFile`. Absent by default, so the instance can be used without a filesystem.
- `maxIncludeDepth` — upper bound on `x-include` nesting; exceeding it throws `ReflowIncludeError { reason: 'depth_exceeded' }`.
- `selectorCacheSize` — capacity of the internal LRU cache for parsed selectors passed to `render` as raw strings. Only successful parses are inserted, so malformed input cannot bloat memory. `0` disables the cache entirely.

```js
const reflow = new Reflow({
  helpers: {
    upper: (s) => String(s).toUpperCase(),
    fmtBytes: (n) => n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`,
  },
  maxIncludeDepth: 20,
});
```

### `compile(name, html): Promise<void>`

Parse an HTML template and register it under `name`. Async because the parser drives HTMLRewriter, which is streaming. Registering the same name twice throws `ReflowCompileError`; call `clear(name)` first to replace.

```js
await reflow.compile('page', `
  <div x-data="user: { name: 'Ada' }">
    <h1 x-text="@user.name"></h1>
  </div>
`);
```

### `compileFile(name, pathname): Promise<void>`

Convenience wrapper around `config.loader`. Fails with `ReflowError` if no loader was configured.

```js
const reflow = new Reflow({ loader: (p) => fs.readFile(p, 'utf-8') });
await reflow.compileFile('page', './views/page.html');
```

### `render(name, data?, selector?): string`

Render a registered template synchronously. `data` is exposed to expressions as `$`.

Without `selector`, returns the full-document HTML:

```js
const html = reflow.render('page', { user: { name: 'Ada' } });
```

With `selector`, returns the outer HTML of the single element matched by the CSS selector. Anything other than one match is Fail-fast (`ReflowSelectorError`):

```js
const fragment = reflow.render('page', data, '#user-list');
// throws ReflowSelectorError { reason: 'no_match' | 'multiple_matches' } otherwise
```

`selector` accepts either a string (parsed and memoised in the instance LRU) or a pre-compiled selector from `Reflow.compileSelector`. See [`fragment-rendering`](./guides/fragment-rendering.md) and [`template/directives`](./template/directives/README.md) for the supported grammar and how positional pseudo-classes behave against runtime iteration.

### `clear(name?): string[]`

Remove one or all templates from the instance cache. Returns the removed names, useful for hot-reload lifecycles.

```js
reflow.clear('page');          // → ['page'] (or [] if 'page' was not registered)
reflow.clear();                // → every previously-registered name
```

### `templates(): string[]`

List all currently-registered template names.

### `Reflow.compileSelector(source): CompiledSelector`

Pre-parse a selector once for hot paths. The returned object is frozen and safe to share across instances, requests, and worker isolates. Passing a `CompiledSelector` back into `render` bypasses the instance LRU entirely.

```js
const USER_LIST = Reflow.compileSelector('#user-list');

app.get('/users', (req, res) => {
  res.send(reflow.render('page', data, USER_LIST));
});
```

### `Reflow.render(html, data?, config?): Promise<string>`

One-shot render for CLIs, tests, and one-off generation. Compiles the HTML into a fresh instance, renders once, and discards. Do not use on hot paths — allocate a `Reflow` instance and compile once instead.

```js
const html = await Reflow.render('<h1 x-text="$.title"></h1>', { title: 'Hello' });
```

`config` is the same shape as the constructor's plus an optional `selector` field:

```js
const fragment = await Reflow.render(html, data, { selector: '#header' });
```

### `Reflow.renderFile(pathname, data?, config?): Promise<string>`

Same one-shot semantics driven by `config.loader`.

## Error hierarchy

Every error thrown by the library extends `ReflowError`, which itself extends `Error`. The constructor copies each key of the `meta` argument onto the instance (except `cause`, which is assigned to `Error.cause`), so callers can read the metadata directly:

```js
try {
  await reflow.compile('page', html);
} catch (err) {
  if (err instanceof ReflowCompileError) {
    console.error(err.templateName, err.line, err.column);
    console.error(err.snippet);        // multi-line snippet with a caret
    console.error(err.element);        // reconstructed opening tag
  }
}
```

Common metadata (present when applicable):

| Field | Meaning |
|---|---|
| `templateName` | The template that produced the error. |
| `snippet` | Multi-line source excerpt with a caret pointing at the offending token. |
| `line`, `column` | 1-based coordinates within `templateName`. |
| `element` | Reconstructed opening tag string. |
| `directive` | `x-*` directive that raised the error. |
| `attribute` | Attribute name (for `x-bind:*` failures). |
| `expression` | Source of the failing expression. |
| `includeStack` | Chain of `templateName`s when the error surfaces through `x-include`. |
| `reason` | Machine-readable code (see below). |
| `requested` | Include target name that failed to resolve. |
| `source` | Raw selector string (for `ReflowSelectorError`). |
| `feature` | Rejected selector construct (for `ReflowSelectorError { reason: 'unsupported' }`). |
| `cause` | Underlying wrapped error. |

### `class ReflowCompileError`

Thrown by `compile()` for statically detectable failures: HTML parse errors, unknown `x-*` attributes, invalid `x-data` / `x-with` / `x-for` / `x-each` values, orphan `x-elseif` / `x-else` / `x-case` / `x-nocase`, forbidden directive combinations, unregistered helper references, duplicate `x-data`, duplicate `x-with`, `x-data` / `x-with` name collisions on the same element, `x-break` outside a loop, malformed expressions, and duplicate template registration.

### `class ReflowRuntimeError`

Thrown by `render()` for runtime failures that are not include-specific: expression `TypeError`s (property access on `undefined` without `?.`), exceptions from helpers, unsupported value types for `x-text` / `x-html` / `x-bind` (e.g. an object where a primitive is required), or a non-array `x-each` collection.

### `class ReflowIncludeError`

Thrown for `x-include`-specific runtime failures. `reason` is one of:

| `reason` | Meaning |
|---|---|
| `'invalid'` | The include expression did not evaluate to a string. |
| `'not_found'` | The requested template is not registered. |
| `'cycle'` | The requested template is already on the include stack. |
| `'depth_exceeded'` | Include depth exceeds `maxIncludeDepth`. |

### `class ReflowSelectorError`

Thrown for CSS-selector-related failures. `reason` is one of:

| `reason` | Meaning | Extra fields |
|---|---|---|
| `'syntax'` | Malformed selector. | `source`, `position` |
| `'unsupported'` | A valid CSS construct reflow intentionally rejects. | `source`, `feature` |
| `'no_match'` | The selector matched zero elements at runtime. | `templateName`, `source` |
| `'multiple_matches'` | The selector matched more than one element. | `templateName`, `source`, `matches: Array<{ templateName }>` |

See [Fragment rendering](./guides/fragment-rendering.md) for the accepted selector grammar and the single-fragment contract.

## Types (JSDoc / TypeScript)

The `.d.ts` bundle regenerated by `npm run build:types` publishes:

```ts
type Config = /* as above */;
type CompiledSelector = { readonly source: string; /* opaque internal AST */ };

class Reflow {
  constructor(config?: Config);
  compile(name: string, html: string): Promise<void>;
  compileFile(name: string, pathname: string): Promise<void>;
  render(name: string, data?: object, selector?: string | CompiledSelector): string;
  clear(name?: string): string[];
  templates(): string[];

  static compileSelector(source: string): CompiledSelector;
  static render(html: string, data?: object, config?: Config & { selector?: string | CompiledSelector }): Promise<string>;
  static renderFile(pathname: string, data?: object, config?: Config & { selector?: string | CompiledSelector }): Promise<string>;
}
```
