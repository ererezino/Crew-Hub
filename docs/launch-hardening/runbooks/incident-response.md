# Incident Response Runbook

## Severity Levels

| Level | Definition | Examples | Response Time | Resolver |
|-------|-----------|----------|---------------|----------|
| **P0** | Security breach or data loss affecting any user | Auth compromise, data exfiltration, RLS bypass, accidental data deletion | Immediate (< 15 min) | Any available engineer, escalate to lead |
| **P1** | Core feature completely broken for all users | Login broken, dashboard unreachable, all cron jobs failing, database down | < 30 min | On-call engineer |
| **P2** | Feature degraded or broken for subset of users | Slow queries, intermittent timeouts, one cron job failing, file upload errors | < 2 hours | On-call engineer |
| **P3** | Minor issue, cosmetic, or non-blocking | UI glitch, stale cache, non-critical notification not sent | Next business day | Assigned developer |

---

## Communication Protocol

### Internal Communication

1. **Declare the incident** in the team Slack channel with severity level, e.g.:
   ```
   INCIDENT P1: Users unable to log in. Investigating. - @yourname
   ```
2. **Post updates every 15 minutes** for P0/P1, every 30 minutes for P2
3. **Declare resolution** with a summary:
   ```
   RESOLVED P1: Login issue caused by expired Supabase JWT secret. Rotated key and redeployed. Total downtime: 23 minutes.
   ```

### External Communication (P0/P1 only)

- If user-facing impact exceeds 10 minutes, post an announcement via the Crew Hub announcements system
- For P0 security incidents, prepare a direct email to affected users via Resend within 1 hour of discovery
- Template:

  > **Subject:** Crew Hub Service Disruption - [Date]
  >
  > We experienced a service disruption affecting [feature]. The issue has been resolved as of [time]. [If security: We recommend changing your password as a precaution.]
  >
  > We apologize for the inconvenience.

---

## Initial Triage Steps

Perform these in order for any incident:

### 1. Verify the issue is real
```bash
# Check health endpoint
curl -s https://your-domain.com/api/health | jq .

# Expected healthy response (HTTP 200):
# { "status": "healthy", "checks": { "database": { "status": "healthy", "latencyMs": N }, "environment": { "status": "healthy", "missing": [] } } }
# Unhealthy returns HTTP 503
```

### 2. Check Vercel deployment status
- Go to **Vercel Dashboard > Crew Hub > Deployments**
- Confirm the latest deployment is active and not in error state
- Check **Functions** tab for error spikes

### 3. Check Sentry for errors
- Open Sentry dashboard, filter by last 30 minutes
- Look for new error types or error spikes
- Check if errors correlate with a specific deployment (look at `release` tag)

### 4. Check Supabase
- Open **Supabase Dashboard > Database > Query Performance** for slow queries
- Check **Auth > Users** for unusual login patterns
- Check **Database > Connection Pooler** for pool exhaustion

### 5. Identify scope
- Is the issue affecting all users or a subset?
- Is it tied to a specific role (EMPLOYEE, TEAM_LEAD, MANAGER, HR_ADMIN, FINANCE_ADMIN, SUPER_ADMIN)?
- Is it isolated to a single module or system-wide?

---

## Common Incident Types

### Auth Outage
**Symptoms:** Users cannot log in, 401 errors across the app, session refresh failures.

**Quick checks:**
1. Supabase Auth service status: https://status.supabase.com
2. Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set correctly in Vercel
3. Check if Supabase JWT secret was rotated without updating the app

**Response:** See `auth-incident.md` for detailed steps.

### Database Issues
**Symptoms:** Health endpoint returns `"database": {"status": "unhealthy"}`, slow page loads, timeout errors in Sentry.

**Quick checks:**
1. Health endpoint: check `checks.database.latencyMs` -- normal is < 100ms
2. Supabase dashboard: connection pool usage, active queries
3. Check for long-running queries or lock contention

**Response:** See `outage-response.md` for database recovery steps.

### Deployment Failure
**Symptoms:** New deployment shows errors in Vercel, pages return 500, function invocations failing.

**Quick checks:**
1. Vercel build logs for compilation errors
2. Compare environment variables between working and broken deployments
3. Check if a new dependency or API change caused the break

**Response:**
1. **Immediate rollback:** Vercel Dashboard > Deployments > find last working deployment > Promote to Production
2. Investigate the failed build locally
3. Fix and redeploy

### Data Breach / Suspected Compromise
**Symptoms:** Unauthorized data access, unusual admin-level queries, unexpected privilege escalation, reports from users of account access they did not initiate.

**Response (P0 -- act immediately):**
1. Revoke all active sessions (rotate Supabase JWT secret)
2. See `auth-incident.md` for full containment procedure
3. Notify company leadership within 30 minutes
4. Preserve all logs -- do NOT delete anything
5. Begin forensic timeline reconstruction

---

## Escalation Paths

| Severity | First Responder | Escalate To | Final Escalation |
|----------|----------------|-------------|-----------------|
| P0 | Any engineer | Engineering lead + CTO | CEO (if data breach) |
| P1 | On-call engineer | Engineering lead | CTO |
| P2 | On-call engineer | Engineering lead (if unresolved in 2h) | -- |
| P3 | Assigned developer | Team lead (if blocked) | -- |

### When to escalate:
- You cannot identify the root cause within 30 minutes (P0/P1)
- The issue requires infrastructure access you do not have
- The issue involves potential data exposure or legal implications
- You need to make a decision that affects all users (e.g., full rollback, data wipe)

---

## Post-Incident Review

### Timeline
- P0/P1: Post-mortem document due within 24 hours, review meeting within 48 hours
- P2: Post-mortem document due within 1 week
- P3: No formal post-mortem required; add a note to the incident log

### Post-Mortem Template

Save to `docs/incidents/YYYY-MM-DD-short-description.md`:

```markdown
# Incident: [Short Description]

**Date:** YYYY-MM-DD
**Severity:** P0/P1/P2/P3
**Duration:** X minutes/hours
**Impact:** [Who was affected and how]

## Timeline
- HH:MM UTC - Issue detected / reported by [source]
- HH:MM UTC - Engineer [name] began investigation
- HH:MM UTC - Root cause identified: [description]
- HH:MM UTC - Fix deployed / rollback executed
- HH:MM UTC - Confirmed resolved

## Root Cause
[Clear explanation of what went wrong and why]

## Resolution
[What was done to fix it]

## Action Items
- [ ] [Preventive measure 1] - Owner: [name] - Due: [date]
- [ ] [Preventive measure 2] - Owner: [name] - Due: [date]

## Lessons Learned
[What we would do differently]
```

### Blameless Culture
- Focus on systems and processes, not individuals
- Ask "how did the system allow this?" not "who caused this?"
- Every incident is an opportunity to improve monitoring, tooling, or documentation
