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
| services-list | 346 µs | 341 µs | 552 µs |
| alert-feed | 513 µs | 465 µs | 2.55 ms |
| user-management | 187 µs | 187 µs | 321 µs |
| metrics-overview | 102 µs | 102 µs | 163 µs |
| audit-log | 298 µs | 300 µs | 495 µs |
| **dashboard (x-include)** | **1.40 ms** | **1.44 ms** | **1.80 ms** |

### Compile + Render (full first-request pipeline)

| Scenario | avg | p75 | p99 |
|---|---|---|---|
| services-list | 706 µs | 718 µs | 1.10 ms |
| alert-feed | 637 µs | 651 µs | 972 µs |
| user-management | 565 µs | 572 µs | 813 µs |
| metrics-overview | 455 µs | 462 µs | 698 µs |
| audit-log | 568 µs | 573 µs | 801 µs |
| **dashboard** | **3.28 ms** | **3.34 ms** | **4.94 ms** |

## Notes

- **`render` is the hot path** on a warm Cloudflare Workers isolate: compile runs once (at first request after isolate start), render runs on every subsequent request.
- **The dashboard scenario** (`~101 KB` output) uses `x-include` to compose 5 panels and is the most representative of a real full-page SSR workload.
- **Individual panels** (`6–30 KB`) reflect realistic sub-component renders such as server-side HTMX partial updates.
- Results are **machine-dependent** and vary run to run; re-run `npm run bench` for your own baseline.
