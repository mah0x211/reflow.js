/**
 * @file Memory footprint measurements for reflow templates.
 *
 * Reports:
 *   - source HTML size (bytes)
 *   - compiled template heap footprint (delta between snapshots)
 *   - fragment renders (delta of a single call under GC control)
 *
 * Numbers are approximate: process.memoryUsage() reports the whole heap and
 * V8 timing does not guarantee GC pauses land exactly where we take
 * snapshots. Run repeatedly and take the median.
 *
 * Run with:
 *   node --expose-gc docs/measurements/memory.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Reflow } from '../../src/index.js';

// Reuse the benchmark fixture for realistic sizes.
import servicesListData from '../../bench/data/services-list.js';
import alertFeedData from '../../bench/data/alert-feed.js';
import userMgmtData from '../../bench/data/user-management.js';
import metricsData from '../../bench/data/metrics-overview.js';
import auditLogData from '../../bench/data/audit-log.js';
import dashboardData from '../../bench/data/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchDir = join(__dirname, '..', '..', 'bench');
const readTpl = (name) => readFileSync(join(benchDir, 'templates', `${name}.html`), 'utf-8');

const PANEL_NAMES = ['services-list', 'alert-feed', 'user-management', 'metrics-overview', 'audit-log'];
const ALL_NAMES = [...PANEL_NAMES, 'dashboard'];

const TEMPLATES = Object.fromEntries(ALL_NAMES.map((name) => [name, readTpl(name)]));
const DATA = {
    'services-list': servicesListData,
    'alert-feed': alertFeedData,
    'user-management': userMgmtData,
    'metrics-overview': metricsData,
    'audit-log': auditLogData,
    'dashboard': dashboardData,
};

const helpers = {
    fmtDate: (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19),
    fmtBytes: (b) => b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`,
    pct: (n, total) => total === 0 ? 0 : Math.min(100, Math.round((n / total) * 100)),
    ceil: (n, d) => Math.ceil(n / d),
    plural: (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`,
    cat: (...parts) => parts.map(String).join(''),
    pad2: (n) => String(n).padStart(2, '0'),
};

function forceGc() {
    if (typeof global.gc === 'function') global.gc();
}

async function snapshotHeapAfterGc() {
    forceGc();
    // Two rounds catch generational leftovers.
    forceGc();
    return process.memoryUsage().heapUsed;
}

function fmtBytes(b) {
    if (Math.abs(b) >= 1_048_576) return `${(b / 1_048_576).toFixed(2)} MB`;
    if (Math.abs(b) >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
}

async function measureCompileFootprint() {
    console.log('=== Compiled template heap footprint ===');
    console.log('name                    sourceHTML    heapDelta       ratio');
    console.log('----                    ----------    ---------       -----');
    const rows = [];
    for (const name of ALL_NAMES) {
        const src = TEMPLATES[name];
        const srcBytes = Buffer.byteLength(src, 'utf-8');

        const r = new Reflow({ helpers });
        if (name === 'dashboard') {
            for (const p of PANEL_NAMES) await r.compile(p, TEMPLATES[p]);
        }
        const midpoint = await snapshotHeapAfterGc();
        await r.compile(name, TEMPLATES[name]);
        const after = await snapshotHeapAfterGc();

        const delta = after - midpoint;
        const ratio = (delta / srcBytes).toFixed(2);
        rows.push({ name, srcBytes, delta, ratio });
        console.log(`${name.padEnd(23)} ${fmtBytes(srcBytes).padStart(10)}    ${fmtBytes(delta).padStart(9)}    ${String(ratio).padStart(6)}x`);

        // Keep `r` alive until after measurement.
        void r;
    }
    console.log();
    return rows;
}

async function measureRenderFootprint() {
    console.log('=== Steady-state render heap delta (per call) ===');
    console.log('name                    outputBytes    heapDelta');
    console.log('----                    -----------    ---------');

    const r = new Reflow({ helpers });
    for (const name of ALL_NAMES) await r.compile(name, TEMPLATES[name]);
    // Warm-up
    for (const name of ALL_NAMES) r.render(name, DATA[name]);
    forceGc();

    for (const name of ALL_NAMES) {
        const data = DATA[name];
        const outputBytes = Buffer.byteLength(r.render(name, data), 'utf-8');
        const before = await snapshotHeapAfterGc();
        // A single render — no gc between to catch the transient allocation.
        const html = r.render(name, data);
        void html;
        const after = process.memoryUsage().heapUsed;
        const delta = after - before;
        console.log(`${name.padEnd(23)} ${fmtBytes(outputBytes).padStart(11)}    ${fmtBytes(delta).padStart(9)}`);
    }
    console.log();
}

async function measureFragmentFootprint() {
    console.log('=== Fragment render heap delta (per call) ===');
    console.log('selector                                  outputBytes    heapDelta');
    console.log('--------                                  -----------    ---------');

    const r = new Reflow({ helpers });
    for (const name of ALL_NAMES) await r.compile(name, TEMPLATES[name]);
    // Warm-up
    for (const name of ALL_NAMES) r.render(name, DATA[name]);
    forceGc();

    const specs = [
        { label: '.sidebar', selector: '.sidebar' },
        { label: '.main-content', selector: '.main-content' },
        { label: '.main-content > section:first-child', selector: '.main-content > section:first-child' },
        { label: 'title', selector: 'title' },
    ];
    for (const { label, selector } of specs) {
        try {
            const out = r.render('dashboard', DATA.dashboard, selector);
            const outputBytes = Buffer.byteLength(out, 'utf-8');
            const before = await snapshotHeapAfterGc();
            const html = r.render('dashboard', DATA.dashboard, selector);
            void html;
            const after = process.memoryUsage().heapUsed;
            const delta = after - before;
            console.log(`${label.padEnd(41)} ${fmtBytes(outputBytes).padStart(11)}    ${fmtBytes(delta).padStart(9)}`);
        } catch (e) {
            console.log(`${label.padEnd(41)} skipped (${e.reason ?? e.message})`);
        }
    }
    console.log();
}

if (typeof global.gc !== 'function') {
    console.error('Warning: run with --expose-gc for reliable numbers.');
    console.error('  node --expose-gc docs/measurements/memory.js');
    console.error();
}

await measureCompileFootprint();
await measureRenderFootprint();
await measureFragmentFootprint();
