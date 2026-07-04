/**
 * @file reflow benchmarks — service management dashboard scenarios.
 *
 * Each scenario models a realistic page/section of a SaaS service-management
 * dashboard (service list, alert feed, user table, metrics overview, audit
 * log, etc.) and exercises all major directives so that the JIT-IR path is
 * representative of real-world use.
 *
 * Templates live in bench/templates/*.html.
 * Data lives in bench/data/*.js.
 *
 * Run with:
 *   npm run bench
 *
 * Warm-up phase compiles every template once.  Benchmark phase runs "render"
 * (cached IR) and "compile + render" (full pipeline) separately so both the
 * JIT overhead and the steady-state throughput are visible.
 */

import os from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bench, run } from 'mitata';
import { Reflow } from '../src/index.js';

// -- data modules (executed once at import time) --
import servicesListData from './data/services-list.js';
import alertFeedData from './data/alert-feed.js';
import userMgmtData from './data/user-management.js';
import metricsData from './data/metrics-overview.js';
import auditLogData from './data/audit-log.js';
import dashboardData from './data/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a template file from bench/templates/<name>.html */
const tpl = (name) => readFileSync(join(__dirname, 'templates', `${name}.html`), 'utf-8');

// ---------------------------------------------------------------------------
// Helpers (registered with every Reflow instance)
// ---------------------------------------------------------------------------
const helpers = {
    /** Format Unix-ms timestamp to a short datetime string. */
    fmtDate: (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19),
    /** Prefix bytes with unit (KB / MB). */
    fmtBytes: (b) => b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`,
    /** Clamp a value to a 0–100 range for progress bars. */
    pct: (n, total) => total === 0 ? 0 : Math.min(100, Math.round((n / total) * 100)),
    /** Integer division rounded up (ceiling). */
    ceil: (n, d) => Math.ceil(n / d),
    /** Pluralise a word. */
    plural: (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`,
    /** String concatenation for use in templates. */
    cat: (...parts) => parts.map(String).join(''),
    /** Pad a number with leading zeros to width 2. */
    pad2: (n) => String(n).padStart(2, '0'),
};

// ---------------------------------------------------------------------------
// Templates — loaded from bench/templates/*.html
// ---------------------------------------------------------------------------

const PANEL_NAMES = ['services-list', 'alert-feed', 'user-management', 'metrics-overview', 'audit-log'];

/** @type {Record<string, string>} */
const TEMPLATES = Object.fromEntries(
    [...PANEL_NAMES, 'dashboard'].map((name) => [name, tpl(name)])
);

// ---------------------------------------------------------------------------
// Data — imported from bench/data/*.js
// ---------------------------------------------------------------------------

/** @type {Record<string, object>} */
const DATA = {
    'services-list': servicesListData,
    'alert-feed': alertFeedData,
    'user-management': userMgmtData,
    'metrics-overview': metricsData,
    'audit-log': auditLogData,
    'dashboard': dashboardData,
};

// ---------------------------------------------------------------------------
// Print machine environment
// ---------------------------------------------------------------------------

console.log('\n=== Machine Environment ===');
console.log(`Platform : ${process.platform} ${os.arch()}`);
console.log(`CPU      : ${os.cpus()[0]?.model ?? 'unknown'} × ${os.cpus().length}`);
console.log(`RAM      : ${(os.totalmem() / 1_073_741_824).toFixed(1)} GiB`);
console.log(`Node.js  : ${process.version}`);
console.log(`reflow   : 0.0.0-dev`);
console.log('===========================\n');

// ---------------------------------------------------------------------------
// Warm-up: compile all templates
// ---------------------------------------------------------------------------

const reflow = new Reflow({ helpers });
for (const name of PANEL_NAMES) {
    await reflow.compile(name, TEMPLATES[name]);
}
await reflow.compile('dashboard', TEMPLATES['dashboard']);

// ---------------------------------------------------------------------------
// Sanity-check: print output sizes so results are meaningful
// ---------------------------------------------------------------------------
console.log('=== Output sizes (bytes) ===');
for (const name of [...PANEL_NAMES, 'dashboard']) {
    const html = reflow.render(name, DATA[name]);
    console.log(`  ${name.padEnd(20)}: ${html.length.toLocaleString()} bytes`);
}
console.log();

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

// --- Render: pre-compiled IR, repeated calls (steady-state throughput) ---
for (const name of PANEL_NAMES) {
    const d = DATA[name];
    bench(`render  ${name}`, () => reflow.render(name, d));
}
bench(`render  dashboard (x-include)`, () => reflow.render('dashboard', DATA['dashboard']));

// --- Compile + Render: full pipeline (first-request latency) ---
for (const name of PANEL_NAMES) {
    const tpl = TEMPLATES[name];
    const d = DATA[name];
    bench(`compile+render  ${name}`, async () => {
        const r = new Reflow({ helpers });
        await r.compile(name, tpl);
        r.render(name, d);
    });
}
bench(`compile+render  dashboard`, async () => {
    const r = new Reflow({ helpers });
    for (const n of PANEL_NAMES) await r.compile(n, TEMPLATES[n]);
    await r.compile('dashboard', TEMPLATES['dashboard']);
    r.render('dashboard', DATA['dashboard']);
});

await run();

