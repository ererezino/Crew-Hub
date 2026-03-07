# Pre-Pilot Remediation Deploy Runbook

This runbook covers the remaining deployment-sensitive fixes required before pilot onboarding.

## 1) Apply `schedule_day_notes` RLS Migration

Migration file:
- `supabase/migrations/20260306630000_fix_schedule_day_notes_rls.sql`

Commands:

```bash
cd /Users/zinoasamaige/Crew\ Hub
supabase link --project-ref <SUPABASE_PROJECT_REF>
supabase db push
```

Expected success signal:
- Command exits `0`.
- CLI shows migration `20260306630000_fix_schedule_day_notes_rls.sql` as applied (or reports database already up to date if already applied).

Verify policies:

```bash
psql "$SUPABASE_DB_URL" -c "
select policyname, cmd
from pg_policies
where schemaname='public' and tablename='schedule_day_notes'
order by policyname, cmd;
"
```

Expected result:
- Present: `schedule_day_notes_select`, `schedule_day_notes_insert`, `schedule_day_notes_update`, `schedule_day_notes_delete`.
- Absent: `schedule_day_notes_manage`.

Hard-fail check:

```bash
psql "$SUPABASE_DB_URL" -c "
select count(*) as permissive_policy_count
from pg_policies
where schemaname='public'
  and tablename='schedule_day_notes'
  and policyname in ('schedule_day_notes_manage');
"
```

Expected result:
- `permissive_policy_count = 0`.

## 2) Set `CRON_SECRET`

Generate secret:

```bash
openssl rand -hex 32
```

Where to set:
- App runtime environment (all deployed app environments used by cron routes).
- Scheduler/invoker environment that calls cron endpoints.

Required usage:
- Header must be: `Authorization: Bearer <CRON_SECRET>`.

Verify fail-closed behavior:

```bash
export APP_URL="https://<your-deployed-domain>"
for route in birthday-leave compliance-reminders document-expiry holiday-announcements leave-announcements review-reminders; do
  echo -n "$route missing auth -> "
  curl -s -o /dev/null -w "%{http_code}\n" "$APP_URL/api/cron/$route"
  echo -n "$route wrong auth -> "
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer wrong-secret" "$APP_URL/api/cron/$route"
done
```

Expected result:
- Missing/wrong auth returns `401` for every route.

Verify correct auth:

```bash
export CRON_SECRET="<deployed_cron_secret>"
for route in birthday-leave compliance-reminders document-expiry holiday-announcements leave-announcements review-reminders; do
  echo -n "$route correct auth -> "
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/$route"
done
```

Expected result:
- Each route returns a non-`401` status.

## 3) Post-Deploy Verification Checklist

### A. Team Hub authz

Checks:
1. Login as Org A user with mutation permission.
2. Attempt to mutate Org B Team Hub entity IDs via devtools:
   - `PUT /api/v1/team-hubs/<org_b_hub_id>`
   - `PUT /api/v1/team-hubs/pages/<org_b_page_id>`

Expected:
- Response is `403` or `404`.
- No cross-org mutation occurs.

### B. `schedule_day_notes` RLS

Checks:
1. Org A user can create/read/update/delete notes for Org A schedules.
2. Same user attempts note access against Org B schedule IDs.

Expected:
- Own-org access works.
- Cross-org access is denied (no rows visible/mutable).

### C. Cron auth

Checks:
- Use commands in section 2.

Expected:
- Missing/wrong secret fails (`401`).
- Correct secret is accepted (non-`401`).

### D. Password-safety (invite/create/reset)

Checks:
1. In Admin Invite form, create user and inspect network payload for `POST /api/v1/people`.
2. Trigger `POST /api/v1/people/<id>/reset-password`.
3. Inspect API responses and user-facing success messages.
4. Verify received emails contain setup/reset links and no plaintext credentials.

Expected:
- No `password` field in request payload.
- No plaintext password in API response.
- Messaging references setup/reset links, not temporary passwords.

### E. Payment execution disabled

Endpoint checks:

```bash
curl -s -i -X POST "$APP_URL/api/v1/payments/batch"
curl -s -i -X POST "$APP_URL/api/v1/payments/<payment_id>/retry"
curl -s -i -X POST "$APP_URL/api/v1/payments/webhook"
```

Expected:
- `403` with `FEATURE_DISABLED` response semantics.

UI checks:
1. Open payroll run detail page.
2. Confirm disbursement section explicitly says execution is disabled.
3. Confirm no live payment execution actions are available.

Expected:
- UI does not imply live disbursement execution.
