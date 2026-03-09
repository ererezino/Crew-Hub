# Cron Job Failure Runbook

## Cron Job Inventory

All 6 cron jobs run daily at `0 7 * * *` (07:00 UTC) via Vercel Cron. Each is a `GET` endpoint authenticated with `Authorization: Bearer <CRON_SECRET>`.

| Job | Endpoint | Purpose |
|-----|----------|---------|
| **Document Expiry** | `/api/cron/document-expiry` | Checks for documents nearing expiration and sends notifications to document owners and HR |
| **Holiday Announcements** | `/api/cron/holiday-announcements` | Posts upcoming public holiday announcements to the announcements feed |
| **Leave Announcements** | `/api/cron/leave-announcements` | Posts daily leave/absence announcements so teams know who is out |
| **Compliance Reminders** | `/api/cron/compliance-reminders` | Sends reminders for pending compliance tasks, certifications, and policy acknowledgments |
| **Review Reminders** | `/api/cron/review-reminders` | Sends reminders for upcoming or overdue performance reviews |
| **Birthday Leave** | `/api/cron/birthday-leave` | Auto-grants birthday leave for employees whose birthday is today; sends 7-day advance reminders for birthdays falling on weekends/holidays |

Cron configuration lives in `/vercel.json`.

---

## How to Detect Failures

### 1. Vercel Cron Logs
- **Vercel Dashboard > Crew Hub > Cron Jobs** shows execution history
- Each execution shows status (success/failure), duration, and response status code
- A successful execution returns HTTP 200 with a JSON summary

### 2. Sentry Alerts
- All cron routes are instrumented with Sentry
- Failed executions trigger error events with the cron job name in the transaction
- Configure a Sentry alert rule: **Cron Monitor** or filter errors by transaction name matching `/api/cron/*`

### 3. Health Endpoint (Indirect)
- The `/api/health` endpoint does not directly monitor cron jobs, but a database issue visible there would also cause cron failures

### 4. Manual Verification
Check the last execution results by looking at downstream effects:
- **Document Expiry:** Check `notifications` table for recent document expiry notifications
- **Holiday Announcements:** Check `announcements` table for today's holiday posts
- **Leave Announcements:** Check `announcements` table for today's leave posts
- **Compliance Reminders:** Check `notifications` table for compliance reminder entries
- **Review Reminders:** Check `notifications` table for review reminder entries
- **Birthday Leave:** Check `time_off_requests` table for auto-created birthday leave entries dated today

---

## Manual Re-trigger Procedure

If a cron job fails and you need to re-run it, trigger it manually with `curl`:

```bash
# Replace YOUR_DOMAIN and YOUR_CRON_SECRET with actual values
# The CRON_SECRET is set in Vercel environment variables

# Document Expiry
curl -X GET "https://YOUR_DOMAIN/api/cron/document-expiry" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Holiday Announcements
curl -X GET "https://YOUR_DOMAIN/api/cron/holiday-announcements" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Leave Announcements
curl -X GET "https://YOUR_DOMAIN/api/cron/leave-announcements" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Compliance Reminders
curl -X GET "https://YOUR_DOMAIN/api/cron/compliance-reminders" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Review Reminders
curl -X GET "https://YOUR_DOMAIN/api/cron/review-reminders" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Birthday Leave
curl -X GET "https://YOUR_DOMAIN/api/cron/birthday-leave" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

**Idempotency note:** Most cron jobs check for existing records before creating duplicates (e.g., birthday leave checks if a request already exists for today). However, announcement jobs may create duplicate posts if re-run. Review the response body to confirm what was created.

---

## Common Failure Modes

### 1. Missing or Invalid CRON_SECRET

**Symptoms:** All 6 cron jobs return HTTP 401 `{"error": "Unauthorized"}`.

**Cause:** The `CRON_SECRET` environment variable is missing, empty, or does not match what Vercel Cron sends.

**Recovery:**
1. Check Vercel environment variables: **Settings > Environment Variables > CRON_SECRET**
2. Ensure it exists and is set for the Production environment
3. Vercel Cron sends the secret as `Authorization: Bearer <CRON_SECRET>` -- verify this matches the check in the route handlers
4. If the secret was rotated, redeploy to pick up the new value

### 2. Database Timeout

**Symptoms:** Cron job returns HTTP 500 or times out (Vercel function timeout is 10s on Hobby, 60s on Pro). Sentry shows database connection error or query timeout.

**Cause:** Slow query, connection pool exhaustion, or Supabase outage.

**Recovery:**
1. Check `/api/health` -- if `database.status` is `unhealthy`, this is a broader database issue (see `outage-response.md`)
2. Check Supabase Dashboard for active connections and query performance
3. If a specific query is slow, check for missing indexes:
   - `document-expiry`: queries `documents` table by `expiry_date` range
   - `compliance-reminders`: queries compliance-related tables with date filters
   - `birthday-leave`: queries `profiles` table by birth month/day
4. Re-trigger the job once the database is healthy

### 3. Email Service Down (Resend)

**Symptoms:** Cron job returns HTTP 200 (it completed) but notification emails were not sent. Sentry may show Resend API errors.

**Cause:** Resend API outage or `RESEND_API_KEY` is invalid/expired.

**Recovery:**
1. Check Resend status: https://status.resend.com
2. Verify `RESEND_API_KEY` in Vercel environment variables
3. Check Resend dashboard for failed sends and error messages
4. In-app notifications (stored in the `notifications` table) should still have been created even if email delivery failed
5. Once Resend is back, emails for new events will send normally. For missed emails, you may need to manually re-trigger the cron job (note idempotency caveats above)

### 4. Vercel Function Cold Start Timeout

**Symptoms:** Intermittent failures where the function times out before completing, especially after periods of inactivity.

**Cause:** Serverless cold start combined with complex database queries can exceed the function timeout.

**Recovery:**
1. Check Vercel function logs for execution duration
2. If consistently near the timeout limit, consider:
   - Optimizing database queries in the cron handler
   - Breaking large batch operations into smaller chunks
3. Re-trigger the failed job manually

### 5. Data-Dependent Failures

**Symptoms:** One specific cron job fails while others succeed. The error points to unexpected data shapes.

**Cause:** Bad or unexpected data in the database (null values, missing relations, corrupted records).

**Recovery:**
1. Check Sentry for the specific error message and stack trace
2. Query the database for the problematic records:
   ```sql
   -- Example: Find profiles with missing data that birthday-leave expects
   SELECT id, email, full_name, date_of_birth
   FROM profiles
   WHERE date_of_birth IS NULL
     AND status = 'active';
   ```
3. Fix the data issue, then re-trigger the cron job

---

## Recovery Verification

After re-triggering any cron job, verify it worked:

1. **Check the HTTP response** -- should be 200 with a JSON body summarizing actions taken
2. **Check the database** for expected records:
   ```sql
   -- Verify notifications were created today
   SELECT COUNT(*), type
   FROM notifications
   WHERE created_at::date = CURRENT_DATE
   GROUP BY type;

   -- Verify announcements were posted today
   SELECT id, title, type, created_at
   FROM announcements
   WHERE created_at::date = CURRENT_DATE;

   -- Verify birthday leave was auto-created
   SELECT id, employee_id, leave_type, start_date, status
   FROM time_off_requests
   WHERE leave_type = 'birthday_leave'
     AND created_at::date = CURRENT_DATE;
   ```
3. **Check Sentry** -- confirm no new errors from the re-triggered execution

---

## Preventive Measures

- **Monitor daily:** Add a Sentry cron monitor for each job so you are alerted if a scheduled execution is missed entirely (not just if it errors)
- **Alerting:** Set up Vercel webhook or Sentry alert for any cron job returning non-200 status
- **Logging:** Each cron job should log a summary of what it did (records processed, notifications sent, errors encountered) in its response body for debugging
