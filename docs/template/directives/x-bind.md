# `x-bind:name`

Compute an attribute value at render time. The `:name` suffix specifies which attribute to set. Multiple `x-bind:*` directives may appear on the same element (targeting different attributes).

## Syntax

```
x-bind:<attribute-name>="expression"
```

The attribute name after `bind:` is required; `x-bind` alone is a compile error.

## Value rules

| Value type | Effect |
|---|---|
| `string`, `number`, `bigint` | Emit `attribute-name="value"` with the value HTML-escaped as an attribute value |
| `true` | Emit `attribute-name` as a bare attribute (no `=`) |
| `null`, `undefined`, `false` | Omit the attribute entirely |
| Anything else (object, array, function, symbol) | `ReflowRuntimeError` |

If the same attribute exists both as a static attribute on the element and as a `x-bind:`, the bind result wins.

## Semantics

- Values are computed after `x-data` is pushed but before content directives run.
- Multiple binds on one element target distinct attribute names (repeating the same target is allowed but pointless — the last wins by evaluation order; prefer just one).
- Combines with every other directive.

## Common uses

### Simple attribute binding

```html
<a x-bind:href="$.url" x-text="$.label"></a>
<img x-bind:src="$.avatar" x-bind:alt="$.name">
```

### Conditional / optional attribute

`false`, `null`, or `undefined` omits the attribute — no ternary needed:

```html
<input type="text" x-bind:required="$.required" x-bind:disabled="$.locked">
<!-- $.required = true → <input type="text" required>
     $.required = false → <input type="text"> -->
```

### Boolean attribute pattern (`aria-hidden`, `hidden`, etc.)

```html
<div x-bind:hidden="$.collapsed"></div>
<span x-bind:aria-current="$.active ? 'page' : null"></span>
```

### Dynamic class list via helper

```html
<div x-bind:class="classes($.state)"></div>
```

```js
const reflow = new Reflow({
  helpers: {
    classes: (state) => ['card', state.active && 'card--active'].filter(Boolean).join(' '),
  },
});
```

### Data attributes for selectors

Using `x-bind:data-*` is a good way to expose runtime values that CSS selectors (via [`render(..., selector)`](../../guides/fragment-rendering.md)) can key off — remembering that static selector matching only sees the source, so use `data-*` markers for structural anchors and rely on `x-bind` for value carriage.

```html
<article x-bind:data-updated="$.updatedAt">
  <h1 x-text="$.title"></h1>
</article>
```

## Failure modes

| Trigger | Error |
|---|---|
| `x-bind` without `:<name>` | `ReflowCompileError` |
| Expression syntax error at compile | `ReflowCompileError` |
| Value is an object / array at render | `ReflowRuntimeError { directive: 'x-bind:<name>', attribute: '<name>' }` |
| Helper throws | `ReflowRuntimeError { cause: <original> }` |

## Related

- [`x-text`](./x-text.md) for computed body content.
- [Fragment rendering](../../guides/fragment-rendering.md) for how `x-bind` results interact with the CSS selector engine (they don't participate in structural matching, but they do appear in the emitted output).
