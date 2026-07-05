# Scope resolution

Every expression identifier resolves through one of three symbols. There are **no un-prefixed magic variables** — you always know which stack the value is being pulled from.

| Symbol | Refers to | Source | Notes |
|---|---|---|---|
| `$` | Globals passed to `render(name, data)` | The `data` argument | Always available, never shadowed, carried into included templates. |
| `@name` | A named `x-data` scope | Nearest matching `x-data="name: {...}"` frame | Searches **only** `x-data` frames from innermost outward. Loop frames are skipped. |
| `.name` | The nearest lexical binding | Any enclosing `x-data` or loop variable | Searches **every** frame (both `x-data` and loop) from innermost outward. |

Unresolvable references return `undefined` (never `ReferenceError`). Accessing a property of `undefined` without `?.` raises a `TypeError` that surfaces as `ReflowRuntimeError`.

## The three sources

### `$` — globals

`$` is the object you passed as `data` to `render(name, data)`. It never changes during a render and is passed unchanged into `x-include`-ed templates. Use it for anything the caller supplies: request context, page data, feature flags.

```js
reflow.render('page', { title: 'Home', user: { name: 'Ada' } });
```

```html
<title x-text="$.title"></title>
<span x-text="$.user.name"></span>
```

### `@name` — named `x-data` scope

`x-data` declares one or more named scopes. Each name is reachable as `@name` from that element and its descendants (except across `x-include` boundaries).

```html
<article x-data="post: { title: 'Hello', tags: ['a', 'b'] }">
  <h1 x-text="@post.title"></h1>
</article>
```

Multiple names can be declared in one `x-data` (JSON5, multi-key object):

```html
<div x-data="post: { title: 'Hi' }, meta: { views: 12 }">
  <h1 x-text="@post.title"></h1>
  <span x-text="@meta.views"></span>
</div>
```

Nested `x-data` on descendants adds more frames; searches go innermost-first.

### `.name` — the nearest lexical binding

`.name` resolves through every frame — `x-data` scopes **and** loop variables (`x-for`, `x-each`). It picks the innermost frame that has `name` as a top-level key.

```html
<ul x-data="pagination: { page: 1 }">
  <li x-each="user in $.users" x-text=".user.name"></li>
</ul>
```

- Inside the `<li>`, `.user` resolves to the loop variable (the current array item).
- Inside the `<li>`, `.pagination` resolves to the `x-data` scope one frame up.
- Inside the `<li>`, `.doesnotexist` returns `undefined`.

## Shadowing: when it matters

The two-symbol split (`@` vs `.`) exists specifically for the case where a loop variable shadows a same-named `x-data` scope:

```html
<div x-data="user: { name: 'Alice' }">
  <ul>
    <li x-each="user, i in $.users">
      <span x-text=".user.name"></span>   <!-- the current iteration's user -->
      <span x-text="@user.name"></span>   <!-- 'Alice', from x-data -->
    </li>
  </ul>
</div>
```

Because `.name` searches every frame innermost-first, `.user` inside the loop picks the loop variable. `@user` skips loop frames and finds the `x-data` scope one level up.

If nothing is being shadowed, `.name` and `@name` behave the same way — but pick `.` when the value lives on the current lexical stack (loop variable, adjacent `x-data`) and `@` when you specifically want a named `x-data` frame.

## Include boundaries

An included template inherits only `$` — the caller's `x-data` scopes and loop variables are **not** visible inside it. If a partial needs context, feed it through `$`:

```html
<!-- layout.html -->
<div x-data="site: { name: $.siteName }">
  <header>
    <span x-text="@site.name"></span>                <!-- visible here -->
  </header>
  <main x-include="'feed'"></main>                   <!-- @site not visible inside feed -->
</div>

<!-- feed.html — reaches through globals -->
<section>
  <h1 x-text="$.siteName"></h1>
</section>
```

This design keeps included templates fully composable: they never depend on what their host template happens to declare.

## Frame lifetimes

Frames are pushed and popped by the interpreter in a strict lexical order:

- `x-data` — pushed before evaluating the element's `x-bind` / children / content directives, popped when the element finishes rendering.
- `x-for` — pushed at the start of each iteration with `{ [varName]: i }`, popped at the end of that iteration.
- `x-each` — pushed at the start of each iteration with `{ [itemName]: value }` (and `{ [indexName]: i }` if declared), popped at the end.

That means a helper called inside a loop iteration sees the loop frame; the same helper called outside the loop does not. `x-break` / `x-break-if` unwinds gracefully — the frame is popped and open tags are still closed even when a break fires mid-body.

## Runtime error surface

An unresolvable path yields `undefined`. A property access on `undefined` without `?.` throws `TypeError`, wrapped by the interpreter into `ReflowRuntimeError`:

```html
<!-- $.user is undefined at render time -->
<span x-text="$.user.name"></span>
<!-- → ReflowRuntimeError { expression: '$.user.name', cause: TypeError } -->
```

Add `?.` to opt-in to "return `undefined` instead":

```html
<span x-text="$.user?.name"></span>
```

`ReflowRuntimeError` carries `templateName`, `snippet`, `line`, `column`, `element`, `expression`, and `cause` — all the context you need to point a template author at the failing expression.
