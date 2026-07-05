# `x-break` / `x-break-if`

Exit the innermost enclosing loop (`x-for` or `x-each`) after the current iteration finishes emitting. There is no labelled break — only the innermost loop is unwound.

## Syntax

```
x-break            <!-- unconditional -->
x-break-if="expression"  <!-- unwind if expression is truthy -->
```

- `x-break` takes no value.
- `x-break-if` takes an expression evaluated after the element emits.

## Semantics

- The element carrying `x-break` / `x-break-if` renders normally (its open tag, body, close tag are all emitted). The break fires **after** emission.
- The current iteration's close tag has been emitted before the unwinding starts, so the HTML stays well-formed.
- The break signal unwinds through nested elements up to the innermost `x-for` / `x-each`. Loop frames along the way are popped; subsequent iterations are skipped entirely.
- Compile-time validation: `x-break` / `x-break-if` must appear inside a loop's subtree. Using them outside a loop is a compile error.

## Special rule: "invisible marker" elements

When an element has `x-break` / `x-break-if` and **no other directive, no other attributes, and no static attributes**, Reflow marks it as an invisible marker and skips emitting the element altogether. This lets you drop a bare break sentinel without adding a stray `<span>` to the output:

```html
<ul>
  <li x-each="row in $.rows" x-text=".row.label">
    <span x-break-if=".row.stop"></span>  <!-- not emitted; just triggers the break -->
  </li>
</ul>
```

Add any attribute (`class`, `id`, `data-*`) or another directive and the element becomes visible again.

## Combinations

- Cannot combine with structural (`x-if` / `x-match`) or iteration (`x-for` / `x-each`) on the same element.
- Combines with `x-data`, `x-bind`, and content directives — but note the invisible-marker rule above: adding any of these makes the element visible.
- Only one of `x-break` and `x-break-if` may appear on the same element.

## Common uses

### Early exit on a sentinel value

```html
<ul>
  <li x-each="row in $.rows" x-text=".row.label">
    <span x-break-if=".row.terminal"></span>
  </li>
</ul>
```

### Cap iteration count

```html
<ul>
  <li x-for="i = 1, 100" x-text=".i">
    <span x-break-if=".i >= $.max"></span>
  </li>
</ul>
```

### Break on the first matching item

```html
<ul>
  <li x-each="row, i in $.rows" x-text=".row.name">
    <span x-break-if=".row.name == $.pick"></span>
  </li>
</ul>
```

## Failure modes

| Trigger | Error |
|---|---|
| `x-break` / `x-break-if` outside a loop subtree | `ReflowCompileError` |
| Combining with structural / iteration on the same element | `ReflowCompileError` |
| Both `x-break` and `x-break-if` on the same element | `ReflowCompileError` |
| Expression evaluation error at render | `ReflowRuntimeError` |

## Related

- [`x-for`](./x-for.md) and [`x-each`](./x-each.md) — the loops that `x-break` unwinds.
