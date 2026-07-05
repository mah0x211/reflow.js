# Expression language

Reflow expressions run inside directive attribute values (`x-if="..."`, `x-text="..."`, `x-bind:href="..."`, `x-each="user in $.users"`, etc.). They are intentionally minimal: everything the grammar does not accept must be expressed via a helper function registered on the `Reflow` instance.

This design is a security and predictability choice. Because the expression language cannot allocate closures, perform method calls, or reach a value's prototype, template authors cannot smuggle side effects or prototype-pollution escapes into a template.

## Accepted grammar

Highest precedence first:

```
expr          := ternary
ternary       := coalesce ('?' expr ':' expr)?
coalesce      := logical_or ('??' logical_or)*
logical_or    := logical_and ('||' logical_and)*
logical_and   := comparison ('&&' comparison)*
comparison    := unary (comparison_op unary)?
comparison_op := '==' | '!=' | '<=' | '>=' | '<' | '>'
unary         := ('!')? postfix
postfix       := primary ('?.' identifier | '.' identifier)*
primary       := literal | scope_ref | helper_call | '(' expr ')'
scope_ref     := '$' path_tail
               | '@' identifier path_tail
               | '.' identifier path_tail
path_tail     := ('.' identifier | '?.' identifier)*
helper_call   := identifier '(' arg_list? ')'
arg_list      := expr (',' expr)*
literal       := string_literal | number_literal | 'true' | 'false' | 'null'
```

## Explicitly rejected constructs

The parser Fail-fasts (`ReflowCompileError`) on any of:

- Arithmetic (`+`, `-`, `*`, `/`, `%`) — use a helper.
- String concatenation — use a helper (`cat('Hello, ', $.name)`).
- Method calls (`x.trim()`) — call a helper that wraps the method (`trim($.x)`).
- Array / object / template literals (`[a, b]`, `{ k: v }`, `` `x${y}` ``) — build the value in `data` or via a helper.
- Assignment, regex, bitwise operators, `in`, `instanceof`, `typeof`, `void`, `delete`.

Banning method calls also prevents `.constructor`-based prototype escapes: `$.user.constructor(...)` is not parseable, full stop.

## Literals

Strings use single or double quotes; standard escape sequences (`\n`, `\t`, `\\`, `\'`, `\"`, `\uNNNN`) are recognized inside them.

```html
<span x-text="'Hello, ' && ''">…</span>  <!-- (illustrative — logical ops don't do concatenation) -->
<a x-bind:href="'/'"></a>
<meta x-bind:charset="'utf-8'">
```

Numbers: integer or decimal, with an optional leading minus. Scientific notation and `0x` / `0b` prefixes are **not** accepted.

```html
<div x-if="$.age >= 18">…</div>
<span x-text="-1"></span>
<span x-text="3.14"></span>
```

Booleans and null: `true`, `false`, `null` are keywords. `undefined` is not a literal — reference an unresolvable scope path (e.g. `$.does.not.exist?.name`) if you need it.

## Operators

- `==` and `!=` are **strict** equality (JavaScript's `===` / `!==`). There is no loose comparison.
- `<`, `<=`, `>`, `>=` use JavaScript's relational semantics — numbers compare numerically; strings compare lexicographically; mixing types follows the JS coercion rules.
- `&&` and `||` short-circuit and return the deciding operand (not a boolean coercion). This makes `$.override || $.default` a valid fallback pattern.
- `??` returns the left operand when it is neither `null` nor `undefined`, else the right; falsy-but-defined values (`0`, `''`, `false`) pass through.
- `!` boolean-inverts (`!!x` gives you a plain boolean).
- Ternary `a ? b : c` has JavaScript semantics.
- Precedence follows the grammar above (postfix > unary > comparison > `&&` > `||` > `??` > ternary).

## Property access

Property paths use `.name` (throws on `undefined`) and `?.name` (short-circuits to `undefined`). Only identifier property names are supported — computed access (`$.map[key]`) is not part of the grammar; delegate through a helper if you need it.

```html
<span x-text="$.user?.profile?.displayName"></span>
```

`.name` on `undefined` raises a `TypeError` that surfaces as `ReflowRuntimeError` with the failing expression source:

```html
<!-- when $.user is undefined -->
<span x-text="$.user.name"></span>
<!-- → ReflowRuntimeError: Cannot read properties of undefined (reading 'name') -->
```

Add `?.` at the point where absence is legitimate to opt into "return `undefined` instead":

```html
<span x-text="$.user?.name"></span>       <!-- emits nothing when $.user is undefined -->
```

## Scope references

Every path starts with one of three symbols:

- `$` — the globals passed to `render(name, data)`. Always available, never shadowed.
- `@name` — a value from an enclosing `x-data` scope. Search is innermost-first through data frames only; loop variables are skipped.
- `.name` — the nearest lexical binding. Search is innermost-first through **all** frames (both `x-data` and loop variables).

See [Scope resolution](./scopes.md) for the exact rules and the shadowing example.

Unresolvable scope references return `undefined` rather than throwing — accessing a property of that undefined without `?.` is what raises.

## Helper calls

A helper call is `identifier(arg1, arg2, ...)`, where the identifier must have been registered on the instance's `config.helpers`. Referencing an unregistered helper is Fail-fast at compile time.

```js
const reflow = new Reflow({
  helpers: {
    upper: (s) => String(s).toUpperCase(),
    fmt: (n, locale) => new Intl.NumberFormat(locale).format(n),
    join: (arr, sep) => arr.join(sep),
  },
});
```

```html
<h1 x-text="upper($.title)"></h1>
<span x-text="fmt($.total, 'en-US')"></span>
<p x-text="join($.tags, ', ')"></p>
```

Helpers can be nested and can take any expression as arguments:

```html
<span x-text="upper(fmt($.count, 'en-US'))"></span>
<span x-text="join($.items, $.separator ?? ', ')"></span>
```

Helpers must be **synchronous**. Throwing from a helper surfaces as `ReflowRuntimeError` with the original error attached as `cause`.

## Type coercion at directive boundaries

The expression language does not coerce values; the directive that consumes the result does. See the per-directive pages for the exact rules — briefly:

- `x-text` / `x-bind` accept primitives; objects and arrays raise `ReflowRuntimeError`.
- `x-html` requires a string.
- `x-include` requires a string (the template name).
- `x-each` requires an array.
- `x-if` / `x-elseif` / `x-break-if` coerce with `!!`.
- `x-match` / `x-case` compare with strict `===`.

## Error surface

Every expression carries its source substring in the parsed AST. When evaluation fails, `ReflowRuntimeError.expression` holds that substring so error messages point at the exact fragment:

```js
try {
  reflow.render('page', {});
} catch (err) {
  console.error(err.expression);   // e.g. ".user.name"
  console.error(err.snippet);      // multi-line source with a caret
  console.error(err.cause);        // TypeError: Cannot read properties of undefined
}
```

## Design rationale

- **No `eval`, no `new Function`** — parseable and interpretable code only. The bundle carries its own recursive-descent parser (`src/expr/parse.js`) and interpreter (`src/expr/evaluate.js`); nothing runs through `Function` constructors.
- **No arithmetic in expressions** — arithmetic quickly grows into formatting, precision, and localization concerns that belong in application code. `fmtBytes`, `pct`, `pad2` etc. are one-liners on the helpers object.
- **No method calls** — if the runtime evaluator could walk `.constructor`, `.__proto__`, or any built-in method, templates could reach the prototype chain. Method calls are simply not parseable.
