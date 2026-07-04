/** @file Benchmark data for the services-list scenario. */

const statuses = ['healthy', 'degraded', 'down', 'maintenance'];
const regions = ['us-east-1', 'eu-west-1', 'ap-northeast-1'];
const types = ['api', 'database', 'cache', 'queue', 'cdn'];

export default {
    org: { name: 'Acme Corp', plan: 'enterprise', memberCount: 142 },
    services: Array.from({ length: 40 }, (_, i) => ({
        id: `svc-${String(i + 1).padStart(3, '0')}`,
        name: `${types[i % types.length]}-service-${i + 1}`,
        type: types[i % types.length],
        status: statuses[i % statuses.length],
        region: regions[i % regions.length],
        uptime: Number((99 - (i % 5) * 0.3).toFixed(2)),
        responseTimeMs: 120 + (i % 10) * 30,
        requestsPerMin: 1000 + i * 47,
        errorRate: Number((0.01 + (i % 4) * 0.005).toFixed(3)),
        lastIncident: i % 3 === 0 ? Date.now() - i * 60_000 : null,
        tags: [`team-${i % 6}`, 'env-prod', types[i % types.length]],
        deployed: Date.now() - i * 86_400_000,
    })),
    summaryStats: {
        total: 40, healthy: 20, degraded: 10, down: 5, maintenance: 5,
    },
};
