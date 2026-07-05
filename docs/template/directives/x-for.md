# `x-for`

Iterate an inclusive integer range. Each iteration re-renders the element with a loop variable bound to the current integer.

## Syntax

```
x-for="varName = start, stop"
x-for="varName = start, stop, step"
```

- `start`, `stop`, `step` are integer literals only (parsed at compile time). Non-literal expressions are Fail-fast.
- `step` defaults to `1` when ascending (`start <= stop`) and `-1` when descending (`start > stop`).
- The range is **inclusive** at both ends. `x-for="i = 1, 3"` iterates over `1, 2, 3`.
- Negative `step` is allowed and requires `start >= stop`. `step` cannot be `0`.

## Semantics

- The element is emitted once per iteration. Each iteration is one runtime "emission" as far as positional pseudo-classes are concerned.
- A loop frame `{ varName: currentInteger }` is pushed before each iteration and popped after.
- Inside the iteration, `.varName` (and `@varName` if no `x-data` shadows it) resolves to the current integer.
- `x-break` / `x-break-if` on a descendant unwinds the innermost enclosing loop, which is this one when the break is inside the iterated element.

## Combinations

- Combines with `x-data`, `x-bind`, and content directives on the same element.
- Cannot combine with structural (`x-if` / `x-match`) or control (`x-break`) on the same element.
- Descendants inside the iterated element may use any directive, including nested `x-for` / `x-each`.

## Common uses

### Pagination page numbers

```html
<nav>
  <a x-for="p = 1, $.totalPages" x-bind:href="pageHref(.p)" x-text=".p"></a>
</nav>
```

### Countdown

```html
<ol>
  <li x-for="i = 10, 1, -1" x-text=".i"></li>
</ol>
```

### Fixed grid

```html
<div class="grid">
  <div class="cell" x-for="i = 1, 12">.i</div>
</div>
```

### Nested loops

```html
<table>
  <tr x-for="r = 1, 3">
    <td x-for="c = 1, 3" x-text="cellLabel(.r, .c)"></td>
  </tr>
</table>
```

## Break

Use [`x-break-if`](./x-break.md) on a descendant to stop early:

```html
<ul>
  <li x-for="i = 1, 100" x-text=".i">
    <span x-break-if=".i == 5"></span>
  </li>
</ul>
```

The current iteration completes (its close tag is still emitted, so HTML stays well-formed) and further iterations are skipped.

## Failure modes

| Trigger | Error |
|---|---|
| Non-integer `start` / `stop` / `step` | `ReflowCompileError` |
| `step == 0` | `ReflowCompileError` |
| `step` sign disagrees with direction (ascending `stop < start` with positive `step`, etc.) | `ReflowCompileError` |
| Combining with structural / control on same element | `ReflowCompileError` |

## Related

- [`x-each`](./x-each.md) for array iteration.
- [`x-break` / `x-break-if`](./x-break.md) for early exit.
