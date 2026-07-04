/** @file Benchmark data for the metrics-overview scenario. */

export default {
    window: '24h',
    totalRequests: 1_920_000,
    totalErrors: 3_840,
    errorRatePct: 0.2,
    avgResponseMs: 52,
    p95ResponseMs: 145,
    topEndpoints: Array.from({ length: 10 }, (_, i) => ({
        path: `/api/v1/${['users', 'services', 'alerts', 'metrics', 'billing'][i % 5]}`,
        method: ['GET', 'POST', 'PUT', 'DELETE'][i % 4],
        count: 120_000 - i * 10_000,
        avgMs: 30 + i * 8,
        errorPct: i * 0.05,
    })),
    timeSeries: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        requests: 80_000 + Math.round(Math.sin(i / 4) * 20_000),
        errors: 200 + i * 10,
        p50: 45 + i,
        p95: 120 + i * 3,
        p99: 450 + i * 5,
    })),
};
