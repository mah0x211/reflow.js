# Template syntax overview

A Reflow template is HTML with directive attributes. The compiler treats it as HTML first — you can open it in a browser, feed it to a formatter, and search it with any HTML-aware tool — and layers behavior on top through a small set of `x-*` attributes.

## Anatomy of a template

```html
<article x-data="post: { title: 'Hello', tags: ['a', 'b'] }">
  <h1 x-text="@post.title"></h1>
  <ul>
    <li x-each="tag in @post.tags" x-text=".tag"></li>
  </ul>
</article>
```

- **Directives** are attributes whose name starts with the configured prefix (default `x-`). Everything else — `id`, `class`, `data-*`, framework attributes — is preserved verbatim in the output.
- **Expressions** appear inside directive values and inside `x-bind:*="..."`. They use a fixed, small grammar (see [Expression language](./expressions.md)); no arbitrary JavaScript.
- **Scopes** resolve identifiers through three explicit symbols: `$` (globals), `@name` (a named `x-data` or `x-with`), and `.name` (the nearest lexical binding). See [Scope resolution](./scopes.md).
- **Helpers** are the escape hatch for anything the expression language does not do: string manipulation, formatting, arithmetic. Register them on the `Reflow` instance and call them by name.

## The directive prefix

The default prefix is `x-` and every reference in these docs uses that. It is configurable per-instance:

```js
new Reflow({ prefix: 'data-x-' });
```

Changing the prefix frees the `x-*` namespace for other tools that use the same convention. The `$`, `@`, and `.` scope symbols are unaffected.

## The categories of directives

| Category | Directive(s) | Purpose |
|---|---|---|
| Scope | [`x-data`](./directives/x-data.md), [`x-with`](./directives/x-with.md) | Declare one or more named scopes reachable as `@name`. `x-data` is a compile-time JSON5 literal; `x-with` evaluates expressions at render time and is also the way to pass named data into an included template. |
| Content | [`x-text`](./directives/x-text.md), [`x-html`](./directives/x-html.md), [`x-include`](./directives/x-include.md) | Replace an element's body with an expression value, raw HTML, or another template. Mutually exclusive. |
| Attribute | [`x-bind:name`](./directives/x-bind.md) | Compute an attribute value at render time. Can be repeated for different attributes. |
| Structural | [`x-if`](./directives/x-if.md) / `x-elseif` / `x-else`, [`x-match`](./directives/x-match.md) / `x-case` / `x-nocase` | Conditional rendering. Chains and matches emit at most one branch. |
| Iteration | [`x-for`](./directives/x-for.md), [`x-each`](./directives/x-each.md) | Repeat an element per integer step or per array item. |
| Control | [`x-break`](./directives/x-break.md), `x-break-if` | Early-exit the innermost enclosing loop. |

Unknown attributes under the configured prefix are rejected at compile time (`ReflowCompileError`); use `data-*` for custom attributes.

## Combination rules

Multiple directives on the same element are allowed with a few explicit exclusions, enforced at compile time:

- **Structural + Iteration** — forbidden. `<div x-if="..." x-each="...">` won't compile; use nesting.
- **Structural + Control** — forbidden. Put `x-break` / `x-break-if` on a child of the branch.
- **Iteration + Control** — forbidden. Put `x-break-if` on a child of the iterated element.
- **Content directives are mutually exclusive** — at most one of `x-text` / `x-html` / `x-include` on the same element.
- **`x-data` and `x-with` may combine with any other directive**, and with each other on the same element as long as they don't declare the same binding name.

## What happens at compile

1. **Scan** — a byte-offset scanner records where each element open tag begins/ends so runtime error messages can quote the source.
2. **Parse** — HTMLRewriter drives a SAX-style walk. Elements, text, and comments become IR nodes.
3. **Directive parse** — each `x-*` attribute is parsed into its own structure (`x-data` → JSON5 scopes, `x-with` → binding list of expression ASTs, `x-for` → range, `x-each` → iteration binding, everything else → an expression AST).
4. **Consolidate** — sibling `x-if / x-elseif / x-else` sequences become a synthetic `chain` node; direct children of an `x-match` element are moved into `directives.match.branches`.
5. **Validate** — orphan `x-elseif`/`x-else`/`x-case`/`x-nocase`, illegal directive combinations, `x-data` / `x-with` name collisions, unregistered helper references, and `x-break` outside a loop all raise `ReflowCompileError` here.
6. **Index** — build the selector index (`byId`, `byClass`, `byTag`, `byAttrName`, parent/depth annotations, includes list) so fragment rendering can start with a small candidate set.

The resulting IR plus the original source HTML is what `render` walks.

## What happens at render

1. **Environment** — a scope stack is initialized with `$` set to the `data` argument.
2. **Walk** — the IR is traversed depth-first. Each element pushes any `x-data` and `x-with` frames, then either iterates itself (`x-for` / `x-each`), branches (`x-if` chain, `x-match`), or emits directly.
3. **Emit** — the open tag (with `x-bind` results merged in), the body content (`x-text` / `x-html` / `x-include` / children), and the close tag are appended to an output buffer. HTML5 void elements skip the close tag.
4. **Break** — `x-break` / `x-break-if` throws a lightweight `BreakSignal` that unwinds to the innermost enclosing loop; close tags are still emitted so the output stays well-formed.
5. **Include** — `x-include` renders the target template with the same globals plus any `x-with` bindings on the include element, otherwise a fresh lexical scope; the include-depth and cycle guards still apply.

The buffer is joined into a string and returned. `render` never suspends; helpers are synchronous.

## Value semantics reference

Different directives require different value types. The interpreter is strict — a mismatch raises `ReflowRuntimeError` rather than silently coercing.

| Directive | Required expression value |
|---|---|
| `x-text` | primitive (`string` / `number` / `bigint` / `boolean`) or `null` / `undefined` (emits nothing) |
| `x-html` | `string`, `null`, or `undefined` |
| `x-bind:name` | primitive → attribute value; `true` → bare attribute; `null` / `undefined` / `false` → omit attribute |
| `x-include` | `string` (registered template name) |
| `x-each="v in expr"` | array |
| `x-for="i = a, b[, step]"` | integer literals only (parsed at compile) |
| `x-with="name = expr, ..."` | any value per binding; consumers apply their own type rules |
| `x-if` / `x-elseif` / `x-break-if` | any value; coerced with `!!` |
| `x-match` / `x-case` | any value; compared with strict `===` |

See each directive's page for the full type rules and failure modes.

## Escaping and safety

- `x-text` HTML-escapes its result using the OWASP recommendation set.
- `x-bind` HTML-escapes its result as an attribute value.
- `x-html` inserts the string verbatim — the template author is responsible for the safety of the input.
- Static attributes are HTML-escaped when re-emitted (Reflow does not pass HTMLRewriter's raw bytes through).
- Text and comment nodes from the source are emitted verbatim (they were already valid HTML).

## Next up

- [Expression language](./expressions.md) — literals, operators, helper calls, optional chaining.
- [Scope resolution](./scopes.md) — how `$`, `@name`, and `.name` resolve, and the shadowing rules.
- [Directive reference](./directives/README.md) — one page per directive.
