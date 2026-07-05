# reflow documentation

Reflow is an attribute-based HTML template engine. Templates are plain HTML annotated with `x-*` directives; the compiler produces a small IR that the interpreter renders synchronously to an HTML string. No client-side runtime is emitted, no `eval` / `new Function` is used, and directive expressions run through a hand-written parser + fixed IR interpreter.

## Contents

- **Reference**
  - [API reference](./api.md) — the `Reflow` class, its methods, options, and error types.
  - [Template syntax overview](./template/README.md) — the shape of a Reflow template and how the pieces fit together.
  - [Expression language](./template/expressions.md) — literals, operators, helper calls, short-circuiting, optional chaining.
  - [Scope resolution](./template/scopes.md) — the `$`, `@name`, and `.` symbols and how they resolve.
  - [Directive reference](./template/directives/README.md) — one page per directive with syntax, semantics, and worked examples.
- **Guides**
  - [Getting started](./guides/getting-started.md) — a five-minute walkthrough.
  - [Fragment rendering](./guides/fragment-rendering.md) — selector-based partial responses (HTMX / Turbo Frames).
  - [Template composition](./guides/template-composition.md) — layouts and content templates via `x-include`.
  - [Performance and memory](./guides/performance.md) — complexity, measured footprints, and how to reason about them.
- **Data**
  - [`measurements/memory.js`](./measurements/memory.js) — the script the performance guide quotes; re-run it locally for numbers on your machine.

## Where to start

- New to Reflow → [Getting started](./guides/getting-started.md).
- Building HTMX-style endpoints → [Fragment rendering](./guides/fragment-rendering.md).
- Writing templates → [Template syntax overview](./template/README.md).
- Sizing a deployment → [Performance and memory](./guides/performance.md).
