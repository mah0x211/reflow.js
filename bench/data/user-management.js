/** @file Benchmark data for the user-management scenario. */

const roles = ['owner', 'admin', 'member', 'viewer', 'billing'];
const plans = ['enterprise', 'pro', 'starter'];

export default {
    pagination: { page: 1, perPage: 25, total: 142 },
    users: Array.from({ length: 25 }, (_, i) => ({
        id: `usr-${String(i + 1).padStart(4, '0')}`,
        name: ['Alice Chen', 'Bob Smith', 'Carol Jones', 'David Kim', 'Eve Nakamura'][i % 5] + ` #${i + 1}`,
        email: `user${i + 1}@acme.example.com`,
        role: roles[i % roles.length],
        plan: plans[i % plans.length],
        mfaEnabled: i % 2 === 0,
        lastLoginAt: Date.now() - i * 3_600_000,
        apiKeyCount: i % 4,
        invitePending: i % 7 === 0,
    })),
};
