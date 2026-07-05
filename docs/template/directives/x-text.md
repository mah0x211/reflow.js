# `x-text`

Replace the element's body with the HTML-escaped result of an expression. This is the safe way to inject a dynamic string value.

## Syntax

```
x-text="expression"
```

## Value rules

| Value type | Result |
|---|---|
| `string`, `number`, `bigint`, `boolean` | Coerced to string and HTML-escaped |
| `null`, `undefined` | Nothing emitted (element renders with an empty body) |
| Anything else (object, array, function, symbol) | `ReflowRuntimeError` |

Escaping uses the OWASP recommendation set: `&`, `<`, `>`, `"`, `'`, `` ` `` are replaced with entity references.

## Semantics

- The element's existing children (if any) are **ignored** at render time and replaced with the escaped value.
- Only one of `x-text`, `x-html`, `x-include` may appear on the same element.
- Combines with `x-data`, `x-bind`, structural directives (`x-if`, `x-match`), and iteration directives (`x-for`, `x-each`).
- Emits nothing on the element itself when the value is `null` or `undefined`; the tags are still emitted (as if the body were empty). Use `x-if` if you want the whole element gone.

## Common uses

### Simple dynamic text

```html
<h1 x-text="$.title"></h1>
<p x-text="$.description"></p>
```

### With helpers for formatting

```html
<span x-text="upper($.name)"></span>
<span x-text="fmt($.amount, 'USD')"></span>
```

### Inside iteration

```html
<ul>
  <li x-each="user in $.users" x-text=".user.name"></li>
</ul>
```

### Optional chaining for possibly-missing values

```html
<span x-text="$.user?.name"></span>
```

## Failure modes

| Trigger | Error |
|---|---|
| Expression syntax error at compile | `ReflowCompileError` |
| Property access on `undefined` without `?.` at render | `ReflowRuntimeError { cause: TypeError }` |
| Value is an object / array at render | `ReflowRuntimeError` |
| Helper throws | `ReflowRuntimeError { cause: <original> }` |

## Related

- [`x-html`](./x-html.md) when you need to inject already-safe HTML.
- [`x-bind:name`](./x-bind.md) when you want to compute an attribute value instead.
