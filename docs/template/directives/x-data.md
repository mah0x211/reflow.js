# `x-data`

Declare one or more named scopes for the element and its descendants. Names become reachable as `@name` from expressions.

## Syntax

```
x-data="name: value"
x-data="name1: value1, name2: value2, ..."
```

The attribute value is parsed as [JSON5](https://json5.org/) — the object body from a JSON5 object literal, without the enclosing braces. Each top-level key becomes a named scope.

## Value type

Each scope value can be any JSON5 value (object, array, string, number, boolean, null). Objects are the most common; the fields inside become reachable via `@name.field`, `.name.field`, etc.

Values are **literal**. `x-data` is parsed once at compile time, so runtime references such as `$`, `@name`, and `.name` are not evaluated inside it — a raw `$` in the value is a JSON5 syntax error and fails compilation.

## Semantics

- Frames are pushed **before** evaluating any other directive on the element. `x-bind`, `x-text`, etc. on the same element can already reference the scope.
- Frames are popped when the element finishes rendering.
- Multiple names may be declared in a single `x-data`; ordering does not matter.
- `x-data` may be repeated on **descendant** elements to layer more scopes. Duplicate names on the same element are Fail-fast at compile time; nested identical names shadow the outer one.
- Nested scopes are searched innermost-first by `@name`.

## Combinations

`x-data` combines freely with every other directive:

```html
<ul x-data="theme: { color: 'blue' }" x-each="row in $.rows">
  <li x-bind:style="'color:' && @theme.color" x-text=".row.label"></li>
</ul>
```

## Common uses

### Named context on the current element

```html
<article x-data="post: { title: 'Hello', published: true }">
  <h1 x-text="@post.title"></h1>
  <span x-if="@post.published">✓ Published</span>
</article>
```

### Multiple scopes on one element

```html
<div x-data="page: { title: 'Home' }, meta: { views: 12 }">
  <title x-text="@page.title"></title>
  <span x-text="@meta.views"></span> views
</div>
```

### Reading globals at the use site

Because `x-data` is a JSON5 literal, values from `$` (or from an outer `@name` / loop variable) cannot be inlined into it. Reference them directly where they are needed instead:

```html
<div>
  <span x-text="$.currentUserName"></span>
  <span x-text="$.currentUserId"></span>
</div>
```

For a derived value that needs a name and lives on a runtime scope, reach for [`x-with`](./x-with.md) — its RHS is a full expression and it pushes an `@name` frame just like `x-data`.

### Layering scopes down the tree

```html
<div x-data="app: { version: '1.0' }">
  <section x-data="page: { title: 'Home' }">
    <h1 x-text="@page.title"></h1>
    <footer x-text="@app.version"></footer>
  </section>
</div>
```

## Failure modes

| Trigger | Error |
|---|---|
| JSON5 parse failure | `ReflowCompileError` |
| Duplicate `x-data` on the same element | `ReflowCompileError` |

## See also

- [`x-with`](./x-with.md) for the runtime-evaluated counterpart (needed when a scope value must be computed from `$` / `@` / helper).
- [Scope resolution](../scopes.md) for the interaction between `@name`, `.name`, and loop variables.
- [`x-include`](./x-include.md) for how scopes cross include boundaries (spoiler: they don't; only `$` and `x-with` bindings do).
