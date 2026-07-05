# Benchmarks

Performance benchmarks for js-reflow, measured with [mitata](https://github.com/evanwashere/mitata).

## Scenarios

All scenarios model realistic sections of a **service management dashboard** — the kind of complex multi-section page that a SaaS admin console would serve.

Templates live in `bench/templates/*.html`.
Data lives in `bench/data/*.js` and is loaded at benchmark startup.

| Scenario | Template | Data | Output |
|---|---|---|---|
| `services-list` | 40-row table, `x-match` status badges, nested tag loops | 40 services with metrics | ~24 KB |
| `alert-feed` | Severity coloring via `x-match`, conditional resolved/ack states | 60 alerts | ~30 KB |
| `user-management` | Role badges, MFA, pagination, per-row conditional states | 25 users | ~16 KB |
| `metrics-overview` | KPI grid, 24-row time series, 10-row endpoint table | Hourly metrics | ~6 KB |
| `audit-log` | Dense log rows, conditional meta expansion, `x-for` page links | 50 log entries | ~24 KB |
| `dashboard` | Full page composed via `x-include` of all 5 panels above | All of the above merged | ~101 KB |

Directives exercised: `x-data`, `x-text`, `x-html`, `x-bind`, `x-if/x-elseif/x-else`, `x-match/x-case/x-nocase`, `x-for`, `x-each`, `x-include`.

## Run

```sh
npm run bench
```

No setup needed — templates and data are read from `bench/templates/` and `bench/data/` at startup.

## What is measured

- **`render <scenario>`** — steady-state hot path: cached IR + data → HTML.
- **`compile+render <scenario>`** — full first-request pipeline: template HTML → JIT parse → IR → HTML.
- **`render <scenario> <selector>`** (via `bench/selector.js`) — steady-state selector fragment extraction from a full-size template, both with a raw string (cached in the per-instance LRU) and with a pre-compiled selector.

## Results (Apple M1 Max, Node.js v24.15.0)

```
=== Machine Environment ===
Platform : darwin arm64
CPU      : Apple M1 Max × 10
RAM      : 32.0 GiB
Node.js  : v24.15.0
reflow   : 0.0.0-dev
===========================

=== Output sizes (bytes) ===
  services-list       : 24,584 bytes
  alert-feed          : 30,033 bytes
  user-management     : 16,146 bytes
  metrics-overview    : 6,130 bytes
  audit-log           : 23,993 bytes
  dashboard           : 101,474 bytes
```

### Render (cached IR — steady-state throughput)

| Scenario | avg | p75 | p99 |
|---|---|---|---|
| services-list | 328 µs | 327 µs | 455 µs |
| alert-feed | 412 µs | 408 µs | 601 µs |
| user-management | 187 µs | 185 µs | 342 µs |
| metrics-overview | 101 µs | 101 µs | 118 µs |
| audit-log | 289 µs | 287 µs | 463 µs |
| **dashboard (x-include)** | **1.39 ms** | **1.37 ms** | **2.11 ms** |

### Compile + Render (full first-request pipeline)

| Scenario | avg | p75 | p99 |
|---|---|---|---|
| services-list | 698 µs | 705 µs | 1.09 ms |
| alert-feed | 627 µs | 626 µs | 1.08 ms |
| user-management | 548 µs | 556 µs | 813 µs |
| metrics-overview | 435 µs | 440 µs | 728 µs |
| audit-log | 559 µs | 559 µs | 844 µs |
| **dashboard** | **3.39 ms** | **3.43 ms** | **5.00 ms** |

### Selector fragment render (dashboard, ~101 KB baseline)

Run `node bench/selector.js`. Fragment sizes and per-selector timings against the full `dashboard` template:

| Selector | Fragment size | avg (string) | avg (pre-compiled) | vs full render |
|---|---|---|---|---|
| `title` | 36 B | 1.20 µs | 1.17 µs | ~1200× faster |
| `.sidebar li.active` | 33 B | 1.18 µs | 1.12 µs | ~1200× faster |
| `.sidebar` | 219 B | 3.42 µs | 3.04 µs | ~450× faster |
| `.main-content` | 101,113 B | 1.38 ms | 1.38 ms | ~parity |
| `.main-content > section:first-child` (positional) | 24,617 B | 340 µs | 339 µs | ~4× faster |

Notes on the selector numbers:

- Small fragments hit the targeted-walk fast path and skip unrelated subtrees entirely, giving 100–1000× speedups over the full render.
- Selecting a fragment that covers most of the template (`.main-content`) still runs the same amount of work as a full render, so it lands at roughly baseline.
- Positional pseudo-classes share a single parent walk across every candidate that shares that parent; non-target siblings are counted (not rendered) by consulting their control-flow directives, and `:first-child` / `:nth-child(n)` terminate the walk as soon as the required position has been visited. `.main-content > section:first-child` therefore fully renders only the first section and evaluates the remaining siblings for their emission counts, which is why it beats the full render.
- Baseline `dashboard (full)` in this run: **1.38 ms/iter**.

## Notes

- **`render` is the hot path** on a warm Cloudflare Workers isolate: compile runs once (at first request after isolate start), render runs on every subsequent request.
- **The dashboard scenario** (`~101 KB` output) uses `x-include` to compose 5 panels and is the most representative of a real full-page SSR workload.
- **Individual panels** (`6–30 KB`) reflect realistic sub-component renders such as server-side HTMX partial updates.
- **Selector fragment extraction** targets HTMX / Turbo Frame style partial responses where the server serves only the changed subtree.
- Results are **machine-dependent** and vary run to run; re-run `npm run bench` (or `node bench/selector.js`) for your own baseline.
