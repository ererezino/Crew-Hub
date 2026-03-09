# Rollback Plan

## Overview

This document describes how to roll back Crew Hub to a previous known-good state if a critical issue is discovered post-launch. Crew Hub is deployed on Vercel with a Supabase PostgreSQL database, so rollback involves coordinating application code, database state, and feature flags.

---

## Vercel Deployment Rollback

Vercel maintains immutable deployments. Every deployment is preserved and can be promoted back to production instantly.

### Via Dashboard (Preferred)
1. Go to **Vercel Dashboard > Crew Hub > Deployments**
2. Find the last known-good deployment (look for the green "Production" badge on the previous stable release)
3. Click **"..." > Promote to Production**
4. The rollback takes effect within seconds -- no build required

**Time to rollback: < 2 minutes**

### Via CLI
```bash
# List recent deployments
vercel ls crew-hub

# Promote a specific deployment to production
vercel promote <deployment-url>
```

### Important Notes
- No code changes or git operations required for immediate rollback
- The rolled-back deployment uses whatever environment variables are currently set in Vercel -- if the issue was caused by an env var change, revert that separately
- Vercel preview deployments (from PRs) are separate and unaffected

---

## Database Migration Rollback

### Strategy: Forward-Only, Additive Migrations

Supabase migrations in this project follow an additive strategy. This means:
- New tables and columns are **added**, never dropped in the same release
- Column renames and type changes use a **copy-migrate-swap** pattern across multiple releases
- This makes most deployments backward-compatible with the previous code version

### When a Migration Needs Reversal

Since migrations are forward-only, you do NOT revert a migration file. Instead:

1. **Write a corrective forward migration** in `supabase/migrations/` with the next timestamp
2. Apply it:
   ```bash
   npx supabase db push
   ```
3. Verify data integrity

Example: if a migration added a NOT NULL column that breaks the old code:
```sql
-- Corrective migration: make the column nullable again
ALTER TABLE some_table ALTER COLUMN new_column DROP NOT NULL;
```

### When Data Corruption Occurs

1. **Stop the bleeding:** Roll back the Vercel deployment to prevent further writes
2. **Assess scope:** Identify which tables and rows are affected
3. **Point-in-Time Recovery (PITR):** Supabase Pro plans support PITR
   - Contact Supabase support or use the dashboard to restore to a specific timestamp
   - Coordinate with the application rollback to ensure schema compatibility
4. **Manual repair:** For small-scope corruption, write corrective SQL queries

### Pre-Migration Checklist (Preventive)

Before deploying any migration:
- [ ] Confirm the migration is additive (no destructive column drops or renames)
- [ ] Test the migration against a copy of production data
- [ ] Verify the previous code version still works with the new schema
- [ ] Back up critical tables if the migration touches them

---

## Feature Flag Rollback via MODULE_STATES

For issues isolated to a specific feature, the fastest and safest rollback is disabling the module via the feature state system in `lib/feature-state.ts`.

### How It Works

The `MODULE_STATES` registry in `lib/feature-state.ts` maps each module to a state that controls visibility and interactivity:

| State | Actions | Navigation | Banner |
|-------|---------|------------|--------|
| `LIVE` | Enabled | Visible | None |
| `LIMITED_PILOT` | Enabled | Visible | "Pilot" info banner |
| `UNAVAILABLE` | Disabled | Hidden | "Preview" banner (direct URL only) |
| `COMING_SOON` | Disabled | Visible | "Coming Soon" banner |
| `BLOCKED` | Disabled | Visible | "Blocked" error banner |

### To Disable a Feature

1. Edit `lib/feature-state.ts`
2. Change the module's state from its current value to `"UNAVAILABLE"` (hides from nav, disables all actions) or `"BLOCKED"` (visible but disabled, shows error banner):
   ```typescript
   // Example: disable the expenses module
   expenses: "UNAVAILABLE",  // was "LIVE"
   ```
3. Commit and deploy
4. The change takes effect immediately for all users on next page load

### Module IDs Available for Toggling

Core modules currently `LIVE`: `dashboard`, `time_off`, `my_pay`, `documents`, `approvals`, `people`, `onboarding`, `expenses`, `compliance`, `time_attendance`, `notifications`, `announcements`, `compensation`

Pilot modules currently `LIMITED_PILOT`: `scheduling`, `payroll`, `team_hub`, `performance`

### Advantages Over Full Rollback
- Surgical: only the broken feature is affected
- Fast: single-line code change + deploy
- Safe: no risk of reverting unrelated fixes or database changes
- Clear: users see an honest banner explaining the feature is temporarily unavailable

---

## Rollback Decision Criteria

| Severity | Condition | Action |
|----------|-----------|--------|
| **P0 -- Data loss or security breach** | Any confirmed data exposure or loss | Immediate Vercel rollback. Any available engineer authorized. |
| **P1 -- Core feature broken for all users** | Login, dashboard, or multiple critical features down | Vercel rollback if caused by latest deploy. Feature flag rollback if isolated. |
| **P2 -- Feature degraded for subset** | One feature slow or partially broken | Feature flag rollback. Hotfix forward if quick. |
| **P3 -- Minor issue** | UI glitch, non-critical notification missed | No rollback. Fix in next release. |

### Decision Tree

```
Issue detected
  |
  +--> Caused by latest deployment?
  |      Yes --> Vercel rollback (< 2 min)
  |      No  --> Continue investigating
  |
  +--> Isolated to a single module?
  |      Yes --> Feature flag rollback via MODULE_STATES
  |      No  --> Continue investigating
  |
  +--> Caused by environment variable change?
  |      Yes --> Revert env var + redeploy
  |      No  --> Continue investigating
  |
  +--> Caused by database migration?
  |      Yes --> Write corrective forward migration
  |      No  --> Continue investigating
  |
  +--> External service outage?
         Yes --> Wait + mitigate with feature flags
         No  --> Escalate per incident-response.md
```

---

## Post-Rollback Verification Checklist

After any rollback, verify the system is healthy:

- [ ] Health endpoint returns HTTP 200 with `"status": "healthy"`:
  ```bash
  curl -s https://your-domain.com/api/health | jq .
  ```
- [ ] Login flow works (test with a non-admin and an admin account)
- [ ] Dashboard loads and displays data
- [ ] Leave request submission works end-to-end
- [ ] Document upload and download work
- [ ] Navigation shows/hides correct modules per `MODULE_STATES`
- [ ] Sentry: no new errors in the 15 minutes after rollback
- [ ] Cron jobs: if rollback happened near 07:00 UTC, verify cron jobs ran or re-trigger manually (see `runbooks/cron-failure.md`)

---

## Communication Plan

### During Rollback

1. Post in team Slack channel:
   ```
   ROLLBACK IN PROGRESS: Rolling back to deployment [ID] due to [brief reason]. ETA: < 5 minutes. - @yourname
   ```

2. If the issue was user-facing for more than 5 minutes, post an in-app announcement via the announcements system

### After Rollback

1. Confirm resolution in Slack:
   ```
   ROLLBACK COMPLETE: Production is now running deployment [ID]. Monitoring for 30 minutes. - @yourname
   ```

2. If users were notified about the outage, send a resolution update (see `runbooks/outage-response.md` for templates)

3. Create an incident record in `docs/incidents/` and schedule a post-mortem per `runbooks/incident-response.md`

---

## Cron Job Emergency Shutoff

If a cron job is causing damage (e.g., sending incorrect notifications, creating bad data):

**Option A: Disable a specific cron job**
1. Remove or comment out the cron entry in `vercel.json`
2. Deploy the change

**Option B: Disable all cron jobs immediately**
1. Rotate `CRON_SECRET` to a new value in Vercel environment variables
2. This immediately blocks all cron executions since the old secret will no longer match
3. No redeployment needed -- env var changes take effect on next function invocation
4. Restore by setting `CRON_SECRET` back and redeploying
