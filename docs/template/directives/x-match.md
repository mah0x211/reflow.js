# `x-match` / `x-case` / `x-nocase`

Value-comparison branch (like `switch` / `case`). The `x-match` element renders normally, but its children must be `x-case` / `x-nocase` elements — only the chosen case is emitted inside the `x-match`'s body.

## Syntax

```
<parent x-match="expression">
  <child x-case="value1">...</child>
  <child x-case="value2">...</child>
  <child x-nocase>...</child>   <!-- optional, at most one, must be last -->
</parent>
```

The value in `x-case` is an expression (typically a literal or a `$.foo` path); it is compared with strict `===` against the `x-match` value. `x-nocase` has no expression — it fires when no `x-case` matched.

## Semantics

- The `x-match` element is emitted with its open and close tags. Its body is either the chosen case (with its own tags emitted normally) or empty (if no case matched and there is no `x-nocase`).
- Cases are evaluated top-down; the first `===` hit wins. No fallthrough.
- Every direct child of an `x-match` element must be an `x-case` or an `x-nocase`. Other elements — or text with non-whitespace content — are compile errors.
- `x-nocase` is optional, and if present must be **last** and **unique**. Placing an `x-case` after `x-nocase` is a compile error.
- At least one `x-case` is required — a lone `x-nocase` is rejected at compile time.
- Whitespace and comments between children are allowed (they are stripped in the same pass that consolidates the branches).

## Combinations

- `x-match` may combine with `x-data` (declares scope for the branches) and `x-bind` (on the `x-match` element itself).
- `x-case` / `x-nocase` elements may combine with `x-data`, `x-bind`, and content directives (`x-text` / `x-html` / `x-include`) on their own element.
- Cannot combine `x-match` with iteration (`x-for` / `x-each`) or control (`x-break`) on the same element.

## Common uses

### Status badge

```html
<span x-match="$.status">
  <span x-case="'ok'" class="ok">OK</span>
  <span x-case="'fail'" class="fail">Fail</span>
  <span x-nocase class="unknown">Unknown</span>
</span>
```

### Route render inside a layout

```html
<main x-match="$.route">
  <section x-case="'home'"><h1>Home</h1></section>
  <section x-case="'about'"><h1>About</h1></section>
  <section x-nocase><h1>404</h1></section>
</main>
```

### Numeric bucket

```html
<div x-match="bucket($.age)">
  <p x-case="0">Child</p>
  <p x-case="1">Teen</p>
  <p x-case="2">Adult</p>
  <p x-case="3">Senior</p>
</div>
```

## Interaction with fragment rendering

Only the chosen case is emitted at runtime, so positional pseudo-classes on the parent count the selected case as the sole element child. See [Fragment rendering — static vs runtime semantics](../../guides/fragment-rendering.md#static-vs-runtime-semantics) for a worked `nth-child` example against an `x-match`.

## Failure modes

| Trigger | Error |
|---|---|
| An `x-match` child is not an `x-case` / `x-nocase` element | `ReflowCompileError` |
| `x-case` appears after `x-nocase` | `ReflowCompileError` |
| Multiple `x-nocase` in the same `x-match` | `ReflowCompileError` |
| No `x-case` (only `x-nocase`) | `ReflowCompileError` |
| `x-case` / `x-nocase` outside an `x-match` parent | `ReflowCompileError` |
| Combining `x-match` with iteration / control on the same element | `ReflowCompileError` |
| Expression evaluation error at render | `ReflowRuntimeError` |

## Related

- [`x-if`](./x-if.md) for conditional chains based on truthiness rather than equality.
