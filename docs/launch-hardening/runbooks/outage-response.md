# Outage Response Runbook

## Quick Diagnosis

### Step 1: Health Endpoint

```bash
curl -s https://your-domain.com/api/health | jq .
```

The `/api/health` endpoint (`GET`) returns:

```json
{
  "status": "healthy | degraded | unhealthy",
  "version": "abc1234",
  "uptime": 3600,
  "timestamp": "2026-03-08T12:00:00.000Z",
  "checks": {
    "database": {
      "status": "healthy | degraded | unhealthy",
      "latencyMs": 45
    },
    "environment": {
      "status": "healthy | unhealthy",
      "missing": []
    }
  }
}
```

| HTTP Status | Meaning |
|-------------|---------|
| 200 | All checks healthy |
| 503 | One or more checks unhealthy/degraded |

**Interpretation:**
- `database.status = "unhealthy"` -- Cannot reach Supabase at all (connection refused or timeout)
- `database.status = "degraded"` -- Connected but query returned an error (e.g., RLS issue, table missing)
- `database.latencyMs > 500` -- Database is reachable but slow; investigate query performance
- `environment.missing` lists any missing env vars (required ones cause `unhealthy` status)

### Step 2: Check External Service Status

| Service | Status Page | What It Affects |
|---------|-------------|-----------------|
| **Vercel** | https://www.vercel-status.com | App hosting, serverless functions, cron jobs, edge network |
| **Supabase** | https://status.supabase.com | Database, Auth, Storage, Realtime |
| **Resend** | https://status.resend.com | Email delivery (notifications, password resets) |
| **Sentry** | https://status.sentry.io | Error tracking (does not affect app functionality) |

### Step 3: Check Vercel Deployment

1. **Vercel Dashboard > Deployments** -- is the latest deployment healthy?
2. **Vercel Dashboard > Functions** -- are functions returning errors?
3. **Vercel Dashboard > Analytics** -- is there an error rate spike?

---

## Database Outage

### Symptoms
- Health endpoint returns `database.status: "unhealthy"`
- All pages that load data show errors or infinite loading
- Sentry flooded with `PostgrestError` or connection timeout errors

### Diagnosis
```bash
# Check if Supabase project is reachable
curl -s "https://<project-ref>.supabase.co/rest/v1/" \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <anon-key>"
```

### Recovery Steps

**If Supabase is having a platform outage:**
1. Confirm on https://status.supabase.com
2. There is nothing to do except wait and communicate to users
3. Monitor the status page for updates
4. Once resolved, verify with the health endpoint

**If the database is reachable but slow:**
1. Open **Supabase Dashboard > Database > Query Performance**
2. Look for long-running queries or lock contention
3. Kill problematic queries if needed:
   ```sql
   -- Find active queries running longer than 30 seconds
   SELECT pid, now() - pg_stat_activity.query_start AS duration, query
   FROM pg_stat_activity
   WHERE state = 'active'
     AND now() - pg_stat_activity.query_start > interval '30 seconds';

   -- Kill a specific query (use with caution)
   SELECT pg_terminate_backend(<pid>);
   ```
4. Check connection pool usage -- if near the limit, investigate connection leaks

**If the connection pool is exhausted:**
1. Check **Supabase Dashboard > Database > Connection Pooler**
2. The app uses the service role client (`createSupabaseServiceRoleClient`) for server-side operations
3. If connections are maxed out, check for:
   - Functions that open connections but don't close them
   - A sudden traffic spike
   - A runaway cron job or retry loop
4. Restarting the Supabase connection pooler may help: **Database > Settings > Restart Connection Pooler**

**If data corruption is suspected:**
1. Do NOT attempt to fix data manually without understanding the scope
2. Supabase Pro plans include Point-in-Time Recovery (PITR)
3. Contact Supabase support with the timestamp of the last known good state
4. Coordinate database restoration with application rollback

---

## Partial Outage Handling

A partial outage affects some features but not others. This is common when a specific database table, external service, or API route has issues.

### Identify the Scope
1. Which features are affected? Check Sentry errors grouped by transaction/route
2. Is it role-specific? (e.g., only HR_ADMIN or FINANCE_ADMIN features broken)
3. Is it data-specific? (e.g., only one organization's data is corrupted)

### Mitigation Options

**Option A: Disable the affected module via feature flags**

Edit `lib/feature-state.ts` and set the affected module to `"UNAVAILABLE"`:
```typescript
// Example: if the expenses module is broken
expenses: "UNAVAILABLE",  // was "LIVE"
```
Deploy the change. The feature gate system will immediately hide the module from navigation and disable all its actions. Users see a "Preview" banner if they access it via direct URL.

**Option B: If the issue is a specific API route**

Add an early return with a maintenance message to the affected route while investigating:
```typescript
return NextResponse.json(
  { error: "This feature is temporarily unavailable. Please try again shortly." },
  { status: 503 }
);
```

**Option C: If an external service (Resend) is down**

Email-dependent features (notifications, password resets) will fail, but core functionality should continue. In-app notifications are stored in the database and will still work. Wait for the service to recover and consider re-triggering missed notifications.

---

## User Communication Templates

### Full Outage

> **Subject:** Crew Hub is Currently Unavailable
>
> We are aware that Crew Hub is currently unavailable and are actively working to restore service. We will provide updates every 30 minutes.
>
> **What's happening:** [Brief, non-technical description]
> **Current status:** Investigating / Identified / Fixing
> **Expected resolution:** [Time estimate if known, otherwise "We will update shortly"]
>
> We apologize for the disruption.

### Partial Outage

> **Subject:** Crew Hub - [Feature Name] Temporarily Unavailable
>
> The [feature name] feature is currently experiencing issues. All other features are working normally.
>
> **What's affected:** [Specific feature and what users can't do]
> **Workaround:** [If any]
> **Expected resolution:** [Time estimate]

### Resolution

> **Subject:** Crew Hub - Service Restored
>
> [Feature/service] has been restored as of [time]. All features are operating normally.
>
> **What happened:** [Brief explanation]
> **Duration:** [Start time] to [end time] ([total duration])
> **What we're doing to prevent this:** [Brief note on preventive measures]
>
> Thank you for your patience.

---

## Rollback Decision Criteria

Use this decision tree when deciding whether to roll back:

1. **Is the issue caused by the latest deployment?**
   - Yes --> Rollback the Vercel deployment (see `rollback-plan.md`)
   - No --> Continue investigating

2. **Is the issue caused by a database migration?**
   - Yes --> Can the migration be reversed with a forward migration?
     - Yes --> Write and apply a corrective migration
     - No --> Contact Supabase support for PITR restoration
   - No --> Continue investigating

3. **Is the issue caused by an environment variable change?**
   - Yes --> Revert the env var in Vercel and redeploy
   - No --> Continue investigating

4. **Is the issue caused by an external service outage?**
   - Yes --> Wait for the service to recover; mitigate user impact with feature flags
   - No --> Escalate per `incident-response.md`

### Rollback Checklist
- [ ] Verify the rollback target deployment was previously stable
- [ ] Check if any database migrations were applied between current and rollback target
- [ ] If migrations were applied, ensure they are backward-compatible (additive-only strategy)
- [ ] Execute the rollback via Vercel Dashboard or CLI: `vercel promote <deployment-url>`
- [ ] Verify health endpoint returns healthy after rollback
- [ ] Test critical flows: login, dashboard load, leave request submission
- [ ] Monitor Sentry for 15 minutes post-rollback for new errors
- [ ] Communicate resolution to affected users
