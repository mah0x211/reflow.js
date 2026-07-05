# Performance and memory

This page documents the algorithmic complexity of the compile / render / fragment-render paths and the memory footprints they exhibit on a realistic dashboard fixture. Numbers are for orientation, not benchmarks; re-run [`docs/measurements/memory.js`](../measurements/memory.js) and [`bench/`](../../bench/README.md) on your target hardware for accurate figures.

## Big picture

- **Parse once, render many.** Compile is asynchronous (drives HTMLRewriter) and does all the work: source scan, IR construction, chain / match consolidation, static validation, and the selector index. Render is synchronous and touches only the IR plus scope frames.
- **No client runtime, no `eval`.** The interpreter walks a fixed IR and evaluates expressions through a small hand-written AST evaluator; there is no code generation.
- **Fragment rendering is a first-class path.** Passing a selector to `render` skips unrelated subtrees entirely via a targeted walk that jumps from the root to the candidate through the ancestor chain of control-flow directives (`x-data`, `x-with`, `x-if`, `x-match`, `x-for`, `x-each`) and stops.

## Complexity

Let `N` = number of element IR nodes in a template, `I` = number of `x-include` elements, `E` = runtime emission count (each `x-each` iteration is one emission), `M` = matched-fragment output byte size.

| Operation | Time |
|---|---|
| `compile(name, html)` | O(N) parse + O(N) IR construction + O(N) index build |
| `render(name, data)` | O(N) walk × runtime iteration multiplier + O(M) string emit |
| `render(..., selector)` static-only | O(ancestor path length + subtree emit); descends only through control-flow ancestors of the candidate |
| `render(..., selector)` positional (`:first-child`, `:nth-child(n)`) | O(parent's siblings up to the required position) + O(fragment size) |
| `render(..., selector)` positional (`:last-*`, `:nth-last-*`, `:only-*`) | O(parent's siblings full walk) + O(fragment size) |
| `render(..., selector)` cross-include | O(I) walks into includes + recursive search inside each |

The selector resolver picks its seed set from the tightest available index axis (`#id` → 1 candidate; class / tag / attribute → smaller bucket first). Combinators are evaluated by walking `parent` back-pointers.

For a rough intuition: **the small-fragment path (`#id`) runs in a few microseconds regardless of template size**, because the walker only executes control-flow ancestors on the way to the target and then emits its subtree. See the "Selector fragment render" section of [`bench/README.md`](../../bench/README.md) for measured numbers.

## Compiled template memory

Measured with `node --expose-gc docs/measurements/memory.js` on Node.js v24.15.0 / Apple M1 Max (rounded, one run):

| Template | Source HTML | Compiled heap delta | Ratio |
|---|---|---|---|
| services-list | 2.0 KB | ~50 KB | ~25x |
| alert-feed | 1.4 KB | ~44 KB | ~32x |
| user-management | 2.1 KB | ~65 KB | ~30x |
| metrics-overview | 1.8 KB | ~66 KB | ~38x |
| audit-log | 1.3 KB | ~55 KB | ~43x |
| dashboard | 776 B | ~18 KB | ~23x |

The dashboard is tiny by itself because it is just an `x-include` orchestrator; its true footprint is the sum of the panels it composes.

Compiled memory scales roughly linearly with **element count**, not with HTML byte count — a template with a few large text blocks compiles cheaply, while one with hundreds of nested elements compiles into a lot of small IR objects. Expression ASTs are also cached inside the IR, so templates with many `x-bind` / `x-text` per element sit at the higher end of the ratio range.

Cache lifetime: the IR lives on the `Reflow` instance until `clear(name)` or `clear()` is called. Releasing an instance releases all its templates and the selector LRU with them.

## Render-time memory

Steady-state single-render heap delta on the same fixture:

| Template | Output size | Heap delta / call |
|---|---|---|
| services-list | 24.0 KB | ~1.3 MB |
| alert-feed | 29.5 KB | ~1.5 MB |
| user-management | 15.8 KB | ~770 KB |
| metrics-overview | 6.0 KB | ~370 KB |
| audit-log | 23.4 KB | ~1.2 MB |
| dashboard (full) | 99.2 KB | ~1.1 MB |

The heap delta is dominated by the string chunks the walker pushes onto the output array; expressions themselves allocate very little. The GC reclaims most of it between calls. If your peak throughput matters, you can pool output arrays externally by wrapping `render` — reflow itself does not attempt to; per-render simplicity is chosen over reuse.

## Fragment-render memory

Fragment renders allocate proportionally to the returned bytes, not the full template. From `docs/measurements/memory.js`:

| Selector | Fragment size | Heap delta / call |
|---|---|---|
| `title` | 38 B | ~9 KB |
| `.sidebar` | 219 B | ~25 KB |
| `.main-content` | 98.9 KB | ~1.0 MB |
| `.main-content > section:first-child` (positional) | 24.0 KB | ~1.4 MB |

Positional pseudo-classes carry a temporary buffer per candidate emission, so their per-call delta is roughly `fragment size × candidate count`. In typical HTMX endpoints — an `#id` fragment for the changed row — the constant is very small.

## What Reflow does *not* allocate

- **No compiled JavaScript functions.** The interpreter's `switch` on IR node types is stable across templates; helpers are called by name lookup, not by generated closures.
- **No shadow DOM / diff structures.** Reflow emits HTML strings; consumers that need diffing (Turbo, HTMX with `hx-swap="morph"`, Alpine.js on the client) handle it downstream.
- **No global caches.** Compiled templates, parsed selectors, and helpers all live on the instance. Multiple instances are cheap and fully isolated.

## Sizing rules of thumb

- A hot Cloudflare Worker isolate should compile every template it needs at first-request time and hold the instance for the isolate's lifetime.
- Budget `~30-45x source HTML` of heap per compiled template as a ballpark.
- Small `#id` fragments cost microseconds and a few KB of heap per call; a full-page render costs low milliseconds and ~1 MB of transient heap. If you serve mostly partials, fragment rendering will pay for itself immediately.
- The selector LRU (`selectorCacheSize`, default 128) holds `~1-2 KB` per entry. Set it to `0` if every hot selector is pre-compiled via `Reflow.compileSelector`.

## Reproducing the numbers

- Micro-benchmarks: `npm run bench` runs the full-render suite. `node bench/selector.js` runs the selector fragment suite.
- Memory measurements: `node --expose-gc docs/measurements/memory.js`.

Both scripts print the machine environment so results from different runs can be compared directly.
