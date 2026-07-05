/**
 * @file Selector fragment benchmarks.
 *
 * Compares fragment extraction of small elements out of a full-size
 * dashboard template against the baseline full-document render, so the
 * targeted-walk path's payoff on real page-scale IR is measurable.
 *
 * Run with:
 *   node bench/selector.js
 */

import os from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bench, run } from 'mitata';
import { Reflow } from '../src/index.js';

// Reuse the existing dashboard fixture so the numbers relate to real
// template shapes.
import servicesListData from './data/services-list.js';
import alertFeedData from './data/alert-feed.js';
import userMgmtData from './data/user-management.js';
import metricsData from './data/metrics-overview.js';
import auditLogData from './data/audit-log.js';
import dashboardData from './data/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tpl = (name) => readFileSync(join(__dirname, 'templates', `${name}.html`), 'utf-8');

const helpers = {
    fmtDate: (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19),
    fmtBytes: (b) => b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`,
    pct: (n, total) => total === 0 ? 0 : Math.min(100, Math.round((n / total) * 100)),
    ceil: (n, d) => Math.ceil(n / d),
    plural: (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`,
    cat: (...parts) => parts.map(String).join(''),
    pad2: (n) => String(n).padStart(2, '0'),
};

const PANEL_NAMES = ['services-list', 'alert-feed', 'user-management', 'metrics-overview', 'audit-log'];

const DATA = {
    'services-list': servicesListData,
    'alert-feed': alertFeedData,
    'user-management': userMgmtData,
    'metrics-overview': metricsData,
    'audit-log': auditLogData,
    'dashboard': dashboardData,
};

const TEMPLATES = Object.fromEntries(
    [...PANEL_NAMES, 'dashboard'].map((name) => [name, tpl(name)])
);

console.log('\n=== Machine Environment ===');
console.log(`Platform : ${process.platform} ${os.arch()}`);
console.log(`CPU      : ${os.cpus()[0]?.model ?? 'unknown'} × ${os.cpus().length}`);
console.log(`RAM      : ${(os.totalmem() / 1_073_741_824).toFixed(1)} GiB`);
console.log(`Node.js  : ${process.version}`);
console.log(`reflow   : 0.0.0-dev`);
console.log('===========================\n');

const reflow = new Reflow({ helpers });
for (const name of PANEL_NAMES) {
    await reflow.compile(name, TEMPLATES[name]);
}
await reflow.compile('dashboard', TEMPLATES['dashboard']);

// -------------------------------------------------------------------------
// A handful of realistic selector targets for the dashboard. The dashboard
// template uses classes / tags rather than ids, and reaches its main
// content through x-include so a selector fallback exercises the
// cross-include search path.
// -------------------------------------------------------------------------

/** @type {Array<{ label: string, selector: string }>} */
const dashboardSelectors = [
    { label: 'nav.sidebar (shallow)', selector: '.sidebar' },
    { label: 'nav > ul > li.active', selector: '.sidebar li.active' },
    { label: 'main.main-content', selector: '.main-content' },
    { label: 'first panel (positional)', selector: '.main-content > section:first-child' },
    { label: 'title tag', selector: 'title' },
];

console.log('=== Fragment sizes ===');
for (const { label, selector } of dashboardSelectors) {
    try {
        const out = reflow.render('dashboard', DATA.dashboard, selector);
        console.log(`  ${label.padEnd(30)} (${selector.padEnd(45)}): ${out.length.toLocaleString()} bytes`);
    } catch (e) {
        console.log(`  ${label.padEnd(30)} (${selector.padEnd(45)}): skipped (${e.reason ?? e.message})`);
    }
}
console.log();

const fullDashboardBytes = reflow.render('dashboard', DATA.dashboard).length;
console.log(`Full dashboard render: ${fullDashboardBytes.toLocaleString()} bytes\n`);

// -------------------------------------------------------------------------
// Benchmarks
// -------------------------------------------------------------------------

// Baseline: full-document render.
bench('render  dashboard (full)', () => reflow.render('dashboard', DATA.dashboard));

// Per-selector fragment renders (raw string, cached at second call).
for (const { label, selector } of dashboardSelectors) {
    try {
        reflow.render('dashboard', DATA.dashboard, selector);
    } catch { continue; }
    bench(`render  ${label} [string]`, () => reflow.render('dashboard', DATA.dashboard, selector));
}

// Same selectors with a pre-compiled selector (skips cache entirely).
for (const { label, selector } of dashboardSelectors) {
    let sel;
    try {
        sel = Reflow.compileSelector(selector);
        reflow.render('dashboard', DATA.dashboard, sel);
    } catch { continue; }
    bench(`render  ${label} [precompiled]`, () => reflow.render('dashboard', DATA.dashboard, sel));
}

await run();
