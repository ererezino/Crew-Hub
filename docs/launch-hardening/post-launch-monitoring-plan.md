# Post-Launch Monitoring Plan

## Overview

This plan covers the first 30 days after production launch. The goal is early detection of issues, rapid response, and establishing baseline metrics for ongoing monitoring.

---

## Health Endpoint Monitoring

### Endpoint: `GET /api/health`

The health endpoint checks database connectivity and environment variable configuration. It returns:
- HTTP 200 with `"status": "healthy"` when all checks pass
- HTTP 503 with `"status": "unhealthy"` or `"status": "degraded"` when checks fail

Response includes:
- `version`: short git SHA of the deployed commit
- `uptime`: seconds since the serverless function cold-started
- `checks.database.latencyMs`: round-trip time to Supabase
- `checks.environment.missing`: list of missing env vars (required and optional)

### Uptime Monitoring Setup
- Use an external monitoring service (UptimeRobot, Better Stack, or Checkly) to poll `/api/health` every 5 minutes
- Alert if:
  - HTTP status != 200 for 2 consecutive checks (10 minutes of downtime)
  - `database.latencyMs` > 500ms for 3 consecutive checks (sustained slow database)
- Track availability percentage -- target: 99.9% uptime

---

## Sentry Error Tracking

### Alert Rules to Configure

| Alert | Condition | Notify |
|-------|-----------|--------|
| **New issue** | First occurrence of a new error type | Slack channel + email |
| **Error spike** | > 10x baseline error rate in 5 minutes | Slack channel + PagerDuty/phone |
| **High-frequency error** | Any single error > 50 occurrences/hour | Slack channel |
| **Auth errors** | Errors matching `401` or `403` status > 20/hour | Slack channel |
| **Unhandled rejection** | Any unhandled promise rejection | Email |

### Key Sentry Filters

Set up saved searches for quick daily review:
- **Auth failures:** `transaction:/api/auth/* level:error`
- **Cron errors:** `transaction:/api/cron/* level:error`
- **Database errors:** `message:*PostgrestError* OR message:*connection*`
- **Client-side crashes:** `level:fatal platform:javascript`

### Sentry Cron Monitors

Configure a Sentry Cron Monitor for each of the 6 cron jobs so Sentry alerts you when a scheduled execution is **missed entirely** (not just when it errors):
- Schedule: `0 7 * * *` (daily at 07:00 UTC)
- Check-in margin: 15 minutes
- Max runtime: 5 minutes

---

## Key Metrics to Watch

### Application Metrics

| Metric | Where to Find | Healthy Range | Warning | Critical |
|--------|--------------|---------------|---------|----------|
| API error rate | Vercel Analytics | < 0.5% | > 1% | > 5% |
| Response time (p95) | Vercel Analytics | < 500ms | > 2s | > 5s |
| Serverless function duration | Vercel Functions | < 3s | > 5s | > 9s (near timeout) |
| Cold start frequency | Vercel Functions | Low | Increasing trend | -- |

### Auth Metrics

| Metric | Where to Find | Healthy Range | Warning | Critical |
|--------|--------------|---------------|---------|----------|
| Login success rate | Supabase Auth logs | > 95% | < 90% | < 80% |
| Account lockouts/hour | Database query | < 3 | > 5 | > 20 |
| Password reset requests/day | Supabase Auth logs | < 10 | > 20 | > 50 |
| Session refresh errors | Sentry | < 5/hour | > 10/hour | > 50/hour |

### Infrastructure Metrics

| Metric | Where to Find | Healthy Range | Warning | Critical |
|--------|--------------|---------------|---------|----------|
| Database connections | Supabase Dashboard | < 50% pool | > 60% pool | > 80% pool |
| Database query latency | Health endpoint | < 100ms | > 300ms | > 1000ms |
| Storage usage | Supabase Dashboard | Normal growth | > 1GB/day growth | > 5GB/day growth |
| Vercel bandwidth | Vercel Dashboard | Within plan limits | > 80% of limit | > 95% of limit |

### Cron Job Metrics

| Metric | Where to Find | Healthy Range | Warning | Critical |
|--------|--------------|---------------|---------|----------|
| Execution success | Vercel Cron tab | 6/6 daily | 1 failure | 2+ consecutive failures |
| Execution duration | Vercel Cron tab | < 10s each | > 30s | Timeout |
| Records processed | Cron response body | Non-zero | Zero (no-op) for 3+ days | Error response |

---

## Alert Thresholds Summary

| Metric | Warning | Critical | Response |
|--------|---------|----------|----------|
| API error rate | > 1% of requests | > 5% of requests | Investigate Sentry, consider rollback |
| Response time (p95) | > 2s | > 5s | Check database, Vercel function logs |
| Health check | 1 failure | 2 consecutive failures | Run outage-response.md |
| Account lockouts/hour | > 5 | > 20 | Run auth-incident.md |
| DB connections | > 60% pool | > 80% pool | Check for connection leaks |
| Cron job failure | 1 missed execution | 2 consecutive misses | Run cron-failure.md |
| Storage growth | > 1GB/day | > 5GB/day | Review upload patterns |

---

## Review Cadence

### Daily (First 2 Weeks)

Spend 15 minutes each morning checking:

- [ ] `/api/health` returning 200
- [ ] Sentry dashboard: any new errors since yesterday?
- [ ] Vercel Cron tab: did all 6 cron jobs run successfully at 07:00 UTC?
- [ ] Vercel Functions: any timeout or error spikes?
- [ ] Supabase Auth: unusual login failure patterns?
- [ ] Supabase Database: connection pool within normal range?
- [ ] Account lockout count (query `profiles` for locked accounts)
- [ ] Storage usage growth trend

### Weekly (Weeks 3-4)

Spend 30 minutes reviewing trends:

- [ ] Error rate trend in Sentry (is it stable, increasing, or decreasing?)
- [ ] API response time trends in Vercel Analytics
- [ ] Database query performance trends in Supabase
- [ ] Failed login attempt patterns (potential brute force)
- [ ] Storage usage projection (will you hit limits?)
- [ ] Cron job reliability over the past week
- [ ] Audit log completeness spot check
- [ ] Review any P2/P3 issues that were deferred

### Monthly (After Week 4)

- [ ] Adjust alert thresholds based on established baselines
- [ ] Review and archive resolved incidents
- [ ] Update runbooks with lessons learned
- [ ] Assess whether monitoring coverage has gaps
- [ ] Plan capacity based on usage trends

---

## Escalation Paths

| Condition | First Response | Escalate To | Timeline |
|-----------|---------------|-------------|----------|
| Health check failing | On-call engineer | Engineering lead | If unresolved in 15 min |
| Error rate > 5% | On-call engineer | Engineering lead | If unresolved in 30 min |
| Suspected security issue | Any engineer | Engineering lead + CTO | Immediately |
| External service outage | On-call engineer | -- (wait for provider) | Monitor hourly |
| Database performance degradation | On-call engineer | Engineering lead | If unresolved in 1 hour |

---

## Dashboard Setup Recommendations

### Vercel Analytics Dashboard
- Enable **Web Analytics** for client-side performance data
- Enable **Speed Insights** for Core Web Vitals tracking
- Monitor:
  - Top routes by request count and error rate
  - Geographic distribution of requests
  - Function execution duration distribution

### Sentry Dashboard
- Create a custom dashboard with widgets for:
  - **Error count by transaction** (bar chart, last 24h)
  - **Error count over time** (line chart, last 7d)
  - **Top 5 error types** (table)
  - **Auth-related errors** (filtered line chart)
  - **Cron job errors** (filtered by transaction `/api/cron/*`)

### Supabase Monitoring
- Use the built-in **Database Health** panel:
  - Active connections over time
  - Query performance (slow query log)
  - Database size growth
- Use the **Auth** panel:
  - Sign-in activity over time
  - Sign-up activity
  - Provider breakdown

### External Uptime Dashboard (Optional)
- If using Better Stack or UptimeRobot, create a public or team-visible status page showing:
  - `/api/health` uptime percentage
  - Response time graph
  - Incident history

---

## Post-30-Day Transition

After 30 days of stable operation:

1. **Reduce review frequency** to weekly with monthly deep-dives
2. **Adjust alert thresholds** based on observed baselines (not estimates)
3. **Archive** the daily checklist; rely on automated alerts
4. **Formalize on-call rotation** if not already in place
5. **Prioritize deferred hardening items**: MFA implementation, E2E test suite, load testing
6. **Document baselines**: record typical error rates, response times, and database latency for future comparison
