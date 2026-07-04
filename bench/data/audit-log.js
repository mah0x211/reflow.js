/** @file Benchmark data for the audit-log scenario. */

const actions = [
    'user.login', 'user.logout', 'service.deploy', 'service.scale',
    'alert.ack', 'api_key.create', 'api_key.revoke', 'settings.update',
    'member.invite', 'member.remove',
];

export default {
    entries: Array.from({ length: 50 }, (_, i) => ({
        id: `audit-${i + 1}`,
        actor: `usr-${String(i % 10 + 1).padStart(4, '0')}`,
        actorName: ['Alice', 'Bob', 'Carol', 'David', 'Eve'][i % 5],
        action: actions[i % actions.length],
        resource: `svc-${String(i % 40 + 1).padStart(3, '0')}`,
        ip: `10.0.${i % 255}.${(i * 3) % 255}`,
        at: Date.now() - i * 180_000,
        success: i % 8 !== 0,
        meta: i % 4 === 0 ? { reason: 'manual override', ticket: `TKT-${1000 + i}` } : null,
    })),
};
