# `x-with`

Declare one or more named bindings by evaluating expressions against the current scope, then expose them to the element and its descendants (and to an included template, when `x-with` sits on an `x-include`).

Where [`x-data`](./x-data.md) is a compile-time constant (JSON5 literal), `x-with` is the runtime-evaluated counterpart. Use `x-data` for static seeds; use `x-with` when the value depends on `$`, an outer `@name` / `.name`, a loop variable, a helper, or a composed object / array.

## Syntax

```
x-with="name = value"
x-with="name1 = value1, name2 = value2, ..."
```

Each `value` is any expression accepted by the [expression language](../expressions.md) — primitives, scope references (`$` / `@name` / `.name` with a member chain), helper calls, object literals, and array literals. See [Composite literals](../expressions.md#composite-literals) for the object / array syntax and the computed-key rule.

Top-level bindings are separated by commas. Commas inside strings, object / array literals, and helper calls are handled correctly — you do not have to escape them.

## Semantics

- Bindings are evaluated **before** the element body renders, so `x-bind`, `x-text`, descendants, and (if present) an `x-include` on the same element can all reference them.
- Bindings on the same `x-with` are evaluated **simultaneously** against the pre-push environment — a later binding does not see an earlier one from the same directive. Use nested elements to chain derivations.
- The resulting bindings are pushed as a single `data` frame, symmetric with `x-data`. Each binding name becomes reachable as `@name` and `.name`.
- If `x-data` is on the same element, `x-data`'s frame is pushed first; `x-with`'s frame is pushed on top and may reference `@data-name` from that element via its expressions.
- Frames are popped when the element finishes rendering.
- On a descendant, `x-with` layers another frame that shadows the outer binding of the same name.

## Value type

Each binding's RHS can produce any JavaScript value (object, array, string, number, boolean, `null`, or `undefined` from an unresolvable path). The binding is stored as-is; consumers apply their own type rules — for example `x-text` still rejects objects and arrays.

## Combinations

`x-with` combines freely with every other directive, including `x-data` on the same element:

```html
<article x-data="theme: { color: 'blue' }" x-with="profile = $.user">
  <span x-text="@theme.color"></span>
  <span x-text="@profile.name"></span>
</article>
```

The only compile-time restriction is that a name declared by `x-with` must not collide with a name declared by `x-data` on the same element — that would introduce a silent shadow. Nested elements may still shadow freely.

## Common uses

### Derive a value from globals

```html
<div x-with="user = { name: $.currentUserName, id: $.currentUserId }">
  <span x-text="@user.name"></span>
</div>
```

### Reshape a loop item

```html
<ul>
  <li x-each="item in $.items" x-with="up = upper(.item.name)">
    <span x-text="@up"></span>
  </li>
</ul>
```

### Pass data across an `x-include` boundary

An included template only inherits `$`; its caller's `x-data` and loop variables are not visible. `x-with` on the `x-include` element is the supported way to pass named values into the included template — the bindings appear inside the partial as `@name`.

```html
<!-- caller -->
<article x-include="'panel'" x-with="title = $.t, body = $.b"></article>

<!-- panel.html -->
<section>
  <h2 x-text="@title"></h2>
  <p x-text="@body"></p>
</section>
```

### Compose with object / array literals and computed keys

```html
<div x-with="row = { [$.keyName]: $.value, ordered: [$.a, $.b] }">
  <span x-text="length(@row.ordered)"></span>
</div>
```

Computed keys must evaluate to a string or number; otherwise the render throws `ReflowRuntimeError`. `length` here would be a helper you register on the instance — the expression language itself does not provide it.

## Failure modes

| Trigger | Error |
|---|---|
| Missing `=` after a binding name | `ReflowCompileError` |
| Duplicate binding name in the same `x-with` | `ReflowCompileError` |
| Same-element name collision with `x-data` | `ReflowCompileError` |
| Duplicate `x-with` on the same element | `ReflowCompileError` |
| Empty value or empty binding list | `ReflowCompileError` |
| Value expression fails to parse | `ReflowCompileError` |
| Reference to an unregistered helper in a value | `ReflowCompileError` |
| Runtime evaluation error (undefined member access, helper throws, non-string/number computed key) | `ReflowRuntimeError` |

## See also

- [`x-data`](./x-data.md) — the compile-time constant counterpart.
- [`x-include`](./x-include.md) — how `x-with` interacts with included templates.
- [Scope resolution](../scopes.md) — how `@name` and `.name` search through data / loop frames.
- [Composite literals](../expressions.md#composite-literals) — object and array syntax reused by `x-with`.
