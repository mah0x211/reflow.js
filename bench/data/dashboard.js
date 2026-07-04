/**
 * @file Benchmark data for the dashboard scenario.
 * Merges all panel datasets into the single globals object
 * that the dashboard template (with x-include) expects.
 */

import services from './services-list.js';
import alerts from './alert-feed.js';
import users from './user-management.js';
import metrics from './metrics-overview.js';
import audit from './audit-log.js';

export default {
    org: services.org,
    services: services.services,
    summaryStats: services.summaryStats,
    activeCount: alerts.activeCount,
    alerts: alerts.alerts,
    pagination: users.pagination,
    users: users.users,
    ...metrics,
    entries: audit.entries,
};
