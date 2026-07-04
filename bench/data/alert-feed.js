/** @file Benchmark data for the alert-feed scenario. */

const severities = ['critical', 'high', 'medium', 'low', 'info'];
const channels = ['pagerduty', 'slack', 'email', 'webhook'];

export default {
    activeCount: 23,
    alerts: Array.from({ length: 60 }, (_, i) => ({
        id: `alert-${i + 1}`,
        title: `Alert: ${['CPU high', 'Memory pressure', 'Latency spike', 'Error surge', '5xx rate'][i % 5]} on svc-${String(i % 40 + 1).padStart(3, '0')}`,
        severity: severities[i % severities.length],
        acknowledged: i % 3 !== 0,
        channel: channels[i % channels.length],
        firedAt: Date.now() - i * 5 * 60_000,
        resolvedAt: i % 4 === 0 ? Date.now() - i * 60_000 : null,
        notes: i % 5 === 0 ? 'Auto-remediation attempted. Manual review required.' : null,
    })),
};
