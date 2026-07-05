# Directive reference

Reflow directives are HTML attributes with the configured prefix (`x-` by default). Every directive has one page here documenting its syntax, semantics, value-type rules, combinations with other directives, worked examples, and failure modes.

## Index

### Scope
- [`x-data`](./x-data.md) — declare one or more named scopes reachable as `@name` (compile-time JSON5 literal).
- [`x-with`](./x-with.md) — declare one or more named bindings by evaluating expressions at render time; also the way to pass named values across an `x-include` boundary.

### Content (mutually exclusive on the same element)
- [`x-text`](./x-text.md) — replace the element's body with an HTML-escaped expression value.
- [`x-html`](./x-html.md) — replace the element's body with raw HTML.
- [`x-include`](./x-include.md) — replace the element's body with another compiled template.

### Attribute
- [`x-bind:name`](./x-bind.md) — compute an attribute value at render time. May be repeated for different attribute names.

### Structural (mutually exclusive on the same element)
- [`x-if`](./x-if.md) — conditional chain (`x-if` / `x-elseif` / `x-else`). At most one branch renders.
- [`x-match`](./x-match.md) — value-comparison branch (`x-match` on the parent, `x-case` / `x-nocase` on the children). Exactly one branch renders (or none).

### Iteration (mutually exclusive on the same element)
- [`x-for`](./x-for.md) — inclusive integer-range iteration.
- [`x-each`](./x-each.md) — array iteration with an optional index variable.

### Control (loop-only)
- [`x-break`](./x-break.md) — unconditional break; `x-break-if` breaks based on an expression.

## Combination rules

Enforced at compile time; violations throw `ReflowCompileError`.

- **Structural + Iteration** — forbidden on the same element. Use nesting.
- **Structural + Control** — forbidden. Put the break on a child of the branch.
- **Iteration + Control** — forbidden. Put the break on a child of the iterated element.
- **Content directives are mutually exclusive** — at most one of `x-text` / `x-html` / `x-include`.
- **`x-data` and `x-with` may combine with any directive** and both push their scope before evaluating the rest. When they appear on the same element, `x-data` is pushed first (its bindings are visible to `x-with` expressions on that element), and neither may declare a name the other already declares.

## Where directives can appear

- `x-elseif` / `x-else` must follow an `x-if` (whitespace / comments between them are allowed and stripped).
- `x-case` / `x-nocase` must be direct children of an `x-match` element. `x-nocase` is optional and, if present, must be last and unique.
- `x-break` / `x-break-if` must be inside an `x-for` or `x-each` subtree (not necessarily direct children).
- `x-include` may appear anywhere; the target template is looked up at render time by name.

Unknown attributes under the configured prefix are rejected at compile time. Use `data-*` for custom attributes.
