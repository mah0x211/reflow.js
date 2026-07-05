# `x-include`

Replace the element's body with another compiled template. Both static (`x-include="'name'"`) and dynamic (`x-include="$.contentTemplate"`) forms work.

## Syntax

```
x-include="expression"
```

The expression is evaluated at render time. Its result must be a **string** — the name of another template registered on the same `Reflow` instance.

## Semantics

- The element renders its own tags. The include result replaces the body content.
- Only one of `x-text` / `x-html` / `x-include` may appear on the same element.
- The included template renders with:
  - **Same globals (`$`)** — inherited from the caller.
  - **Fresh lexical scope** — the caller's `x-data` scopes and loop variables are **not visible** inside the included template.
  - **[`x-with`](./x-with.md) bindings on the include element**, if any, seed the included template's fresh env as its first `data` frame, reachable via `@name` / `.name`. This is the supported way to pass named data across the include boundary.
- The instance's `templates()` map is consulted at render time; if the target is not registered, `ReflowIncludeError { reason: 'not_found' }`.
- The interpreter tracks an include stack and refuses to re-enter a template already on it (`ReflowIncludeError { reason: 'cycle' }`).
- Include depth is bounded by `config.maxIncludeDepth` (default 50); exceeding it raises `ReflowIncludeError { reason: 'depth_exceeded' }`.

## Combinations

- Combines with `x-data`, `x-with`, `x-bind`, structural (`x-if` / `x-match`), and iteration (`x-for` / `x-each`).
- Combines with `x-break-if` on a descendant of an iterated element, as usual.
- `x-with` on the same element passes its bindings into the included template as an initial `data` frame; see [Passing data to an include](#passing-data-to-an-include).

## Common uses

### Layout with a fixed content area

```html
<!-- layout.html -->
<html>
  <body>
    <header>...</header>
    <main x-include="'article'"></main>
    <footer>...</footer>
  </body>
</html>
```

### Dynamic content area (chosen at render)

```html
<!-- layout.html -->
<main x-include="$.content"></main>
```

```js
reflow.render('layout', { content: 'user_page', ...userData });
reflow.render('layout', { content: 'post_page', ...postData });
```

### Reusable panel

```html
<!-- panel.html -->
<section class="panel">
  <h2 x-text="$.panelTitle"></h2>
  <p x-text="$.panelBody"></p>
</section>

<!-- caller -->
<article x-include="'panel'"></article>
```

Everything the panel needs must live on `$` at render time.

### Iterated include

```html
<div x-each="child in $.children">
  <section x-include=".child.template"></section>
</div>
```

### Passing data to an include

Because the included template renders in a fresh lexical scope, the caller's `x-data` scopes and loop variables are not visible inside it. Use [`x-with`](./x-with.md) on the include element to pass named values across the boundary — the bindings become the included template's first `data` frame:

```html
<!-- caller -->
<article x-include="'panel'" x-with="title = $.t, body = $.b"></article>

<!-- panel.html -->
<section>
  <h2 x-text="@title"></h2>
  <p x-text="@body"></p>
</section>
```

`x-with` values are ordinary expressions, so you can pass anything the expression language can construct — object / array literals, helper results, or a reshaped scope value. See [Composite literals](../expressions.md#composite-literals).

## Scope boundary

The included template only sees `$` plus any `x-with` bindings on the include element. Two implications:

1. If a partial needs context that the caller has as `@site` / an `x-each` variable, pass it through `x-with`, put it into `$` first, or expose it through a helper.
2. Partials are always composable — they never depend on what their host template happens to declare, only on the data explicitly handed to them.

See [Template composition — Scope across include boundaries](../../guides/template-composition.md#scope-across-include-boundaries).

## Interaction with fragment rendering

`render(name, data, selector)` searches the entry template first. If it yields zero static candidates, Reflow walks each `x-include` element, executes it, and searches the included template recursively. When the entry template already has candidates, includes are **not** walked. See [Fragment rendering — Cross-include search](../../guides/fragment-rendering.md#cross-include-search).

## Failure modes

| Trigger | Error |
|---|---|
| Combining with `x-text` / `x-html` on the same element | `ReflowCompileError` |
| Expression is not a string at render | `ReflowIncludeError { reason: 'invalid' }` |
| Target template not registered | `ReflowIncludeError { reason: 'not_found', requested }` |
| Target template already on the include stack | `ReflowIncludeError { reason: 'cycle', requested }` |
| Include depth ≥ `maxIncludeDepth` | `ReflowIncludeError { reason: 'depth_exceeded' }` |
| Expression evaluation error at render | `ReflowRuntimeError` |

All include errors carry `includeStack: string[]` — the chain of `templateName`s leading to the failure — plus the standard `templateName` / `snippet` / `line` / `column` / `element` metadata.

## Related

- [Template composition](../../guides/template-composition.md) for design patterns using `x-include`.
- [Scope resolution — Include boundaries](../scopes.md#include-boundaries) for the exact scope rules.
