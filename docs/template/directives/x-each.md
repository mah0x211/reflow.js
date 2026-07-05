# `x-each`

Iterate an array. Each iteration re-renders the element with the current item (and optionally its index) bound as loop variables.

## Syntax

```
x-each="item in expression"
x-each="item, index in expression"
```

The expression is evaluated once per render and must yield an array.

## Value rules

- `expression` value must be an `Array`. Anything else at render time raises `ReflowRuntimeError` (including `null`, `undefined`, plain objects, `Set`, `Map`).
- Empty arrays produce zero iterations (and zero emissions of the element).

## Semantics

- The element is emitted once per iteration. Each iteration is one runtime "emission" as far as positional pseudo-classes are concerned.
- A loop frame `{ [item]: array[i] }` (plus `{ [index]: i }` if declared) is pushed before each iteration and popped after.
- Inside the iteration, `.item` (and `.index` if declared) resolves to the loop variable.
- If a loop variable name collides with a `x-data` scope, `.` binds to the loop variable (innermost frame wins). Use `@name` to reach past the loop variable to the `x-data` scope.
- `x-break` / `x-break-if` on a descendant unwinds the innermost enclosing loop, which is this one when the break is inside the iterated element.

## Combinations

- Combines with `x-data`, `x-bind`, and content directives on the same element.
- Cannot combine with structural (`x-if` / `x-match`) or control (`x-break`) on the same element.

## Common uses

### Simple list

```html
<ul>
  <li x-each="user in $.users" x-text=".user.name"></li>
</ul>
```

### List with index

```html
<ol>
  <li x-each="user, i in $.users">
    <span x-text=".i"></span>: <span x-text=".user.name"></span>
  </li>
</ol>
```

### Table rows

```html
<tbody>
  <tr x-each="row in $.rows">
    <td x-text=".row.id"></td>
    <td x-text=".row.name"></td>
    <td x-text="fmtDate(.row.updatedAt)"></td>
  </tr>
</tbody>
```

### Iterating over an object

The expression must be an array, so pass the entries instead:

```html
<dl>
  <div x-each="entry in $.entries">
    <dt x-text=".entry.key"></dt>
    <dd x-text=".entry.value"></dd>
  </div>
</dl>
```

```js
reflow.render('page', { entries: Object.entries(obj).map(([key, value]) => ({ key, value })) });
```

### Nested loops

```html
<div x-each="group in $.groups">
  <h2 x-text=".group.title"></h2>
  <ul>
    <li x-each="item in .group.items" x-text=".item.label"></li>
  </ul>
</div>
```

### Shadowing example

```html
<div x-data="user: { name: 'Alice' }">
  <ul>
    <li x-each="user, i in $.users">
      .user.name  <!-- current iteration -->
      @user.name  <!-- 'Alice' from x-data -->
    </li>
  </ul>
</div>
```

## Break

Use [`x-break-if`](./x-break.md) on a descendant to stop early:

```html
<ul>
  <li x-each="row in $.rows" x-text=".row.name">
    <span x-break-if=".row.stop"></span>
  </li>
</ul>
```

The current iteration completes (its close tag is still emitted) and further iterations are skipped.

## Failure modes

| Trigger | Error |
|---|---|
| Malformed `x-each` value (missing `in`, missing item name) | `ReflowCompileError` |
| Combining with structural / control on same element | `ReflowCompileError` |
| Expression is not an array at render | `ReflowRuntimeError { directive: 'x-each' }` |
| Expression evaluation error at render | `ReflowRuntimeError` |

## Related

- [`x-for`](./x-for.md) for integer-range iteration.
- [`x-break` / `x-break-if`](./x-break.md) for early exit.
- [Scope resolution](../scopes.md) for the loop-variable shadowing rules.
