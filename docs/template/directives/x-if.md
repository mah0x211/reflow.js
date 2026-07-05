# `x-if` / `x-elseif` / `x-else`

Chain of conditional branches. At most one branch renders per evaluation; the others are skipped entirely.

## Syntax

```
x-if="expression"
x-elseif="expression"
x-else
```

Elements form a chain when they are consecutive siblings (whitespace and comments between them are allowed and stripped at compile time). The chain starts with `x-if`, may contain any number of `x-elseif`, and may end with at most one `x-else`.

## Semantics

- Branches are evaluated top-down. The first branch whose expression is truthy (or the `x-else` with no expression) is rendered; the rest are skipped.
- Only that chosen branch's element is emitted; all others contribute zero elements to the runtime output.
- The chain is a single logical unit — `x-elseif` and `x-else` without a preceding `x-if` are Fail-fast at compile time.
- Truthiness follows JavaScript's `!!` semantics: `false`, `0`, `''`, `null`, `undefined`, `NaN` are falsy; everything else is truthy.

## Combinations

- Combines with `x-data`, `x-bind`, and content directives (`x-text` / `x-html` / `x-include`) on the same branch element.
- Cannot combine with iteration (`x-for` / `x-each`) or control (`x-break` / `x-break-if`) on the same element. Use nesting.

## Common uses

### Simple conditional

```html
<p x-if="$.error" class="error" x-text="$.error"></p>
```

### If / else

```html
<div x-if="$.user">
  <span x-text="$.user.name"></span>
</div>
<div x-else>
  <a href="/login">Sign in</a>
</div>
```

### Multi-branch

```html
<span x-if="$.status == 'ok'" class="ok">OK</span>
<span x-elseif="$.status == 'warn'" class="warn">Warning</span>
<span x-elseif="$.status == 'error'" class="err">Error</span>
<span x-else class="unknown">Unknown</span>
```

### Chain inside iteration

```html
<ul>
  <li x-each="item in $.items">
    <span x-if=".item.new" class="badge">NEW</span>
    <span x-text=".item.title"></span>
  </li>
</ul>
```

## Interaction with fragment rendering

Positional pseudo-classes count runtime emissions, so a false `x-if` branch contributes zero to `:nth-child`. See [Fragment rendering — static vs runtime semantics](../../guides/fragment-rendering.md#static-vs-runtime-semantics).

```html
<ul>
  <li>Head</li>
  <li x-if="$.show">Optional</li>
  <li class="tail">Tail</li>
</ul>
```

`ul li:nth-child(2)` returns the Optional `<li>` when `$.show` is truthy, otherwise the Tail `<li>`.

## Failure modes

| Trigger | Error |
|---|---|
| `x-elseif` / `x-else` with no preceding `x-if` in the same parent | `ReflowCompileError` |
| `x-else` value non-empty | `ReflowCompileError` |
| Multiple `x-else` in a chain | `ReflowCompileError` |
| `x-elseif` after `x-else` | `ReflowCompileError` |
| Combining with iteration / control on same element | `ReflowCompileError` |
| Expression evaluation error at render | `ReflowRuntimeError` |

## Related

- [`x-match`](./x-match.md) for value-comparison branching (like `switch`).
