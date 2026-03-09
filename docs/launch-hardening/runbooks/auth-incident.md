# Auth Incident Runbook

This runbook covers authentication and authorization security incidents for Crew Hub. Auth is managed by Supabase Auth with role-based access control (RBAC) across 6 roles: EMPLOYEE, TEAM_LEAD, MANAGER, HR_ADMIN, FINANCE_ADMIN, SUPER_ADMIN.

---

## Signs of Auth Compromise

### Unusual Login Patterns
- Multiple failed login attempts from the same IP or against the same account
- Successful logins from unexpected geolocations or IP ranges
- Login activity outside normal business hours for a given user's timezone
- Rapid successive logins from different IPs for the same account

### Account Lockouts
- Spike in account lockout events (check Supabase Auth logs)
- Users reporting they cannot log in despite correct credentials
- Mass lockout across multiple accounts simultaneously (suggests automated attack)

### Privilege Escalation
- User performing actions above their role level (e.g., EMPLOYEE accessing HR_ADMIN routes)
- Unexpected changes to user roles in the `profiles` table
- API calls to admin-only endpoints from non-admin sessions
- Sentry errors showing RLS policy violations from authenticated users

### Other Red Flags
- Unexpected password reset emails reported by users
- New user accounts created that no admin recognizes
- Audit log entries with no corresponding user action
- Unusually high API request volume from a single session

---

## Immediate Response (P0)

**Goal:** Contain the breach within 15 minutes.

### Step 1: Assess Scope
Determine whether this is a single compromised account or a systemic breach.

```sql
-- Check recent login activity in Supabase SQL Editor
-- Look for suspicious patterns in the last 24 hours
SELECT
  au.id,
  au.email,
  au.last_sign_in_at,
  au.created_at,
  p.role,
  p.full_name
FROM auth.users au
JOIN public.profiles p ON p.id = au.id
WHERE au.last_sign_in_at > NOW() - INTERVAL '24 hours'
ORDER BY au.last_sign_in_at DESC;
```

### Step 2: Disable Affected Accounts

**Single account compromise:**
```sql
-- Disable a specific user via Supabase SQL Editor
UPDATE auth.users
SET banned_until = '2099-01-01'
WHERE email = 'compromised@example.com';
```

Or via Supabase Dashboard: **Auth > Users > [User] > Ban User**

**Systemic breach (multiple accounts or unknown scope):**
1. Rotate the Supabase JWT secret in **Supabase Dashboard > Settings > API > JWT Secret**
   - WARNING: This invalidates ALL active sessions for ALL users immediately
   - Update `SUPABASE_JWT_SECRET` in Vercel environment variables
   - Redeploy to pick up the new secret
2. This is the nuclear option -- use only when the scope of compromise is unknown

### Step 3: Invalidate Sessions

**For specific users** -- revoke their refresh tokens:
```sql
-- Delete all sessions for a specific user
DELETE FROM auth.sessions
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'compromised@example.com');

-- Delete all refresh tokens for a specific user
DELETE FROM auth.refresh_tokens
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'compromised@example.com');
```

**For all users** -- if JWT secret was rotated, all sessions are already invalid. No further action needed.

---

## Password Reset Procedures

### For Individual Users
1. Go to **Supabase Dashboard > Auth > Users**
2. Find the affected user
3. Click **Send Password Recovery** -- this sends a reset link via Supabase's built-in email
4. Alternatively, use the management API:
   ```bash
   curl -X POST 'https://<project-ref>.supabase.co/auth/v1/admin/generate_link' \
     -H "apikey: <service-role-key>" \
     -H "Authorization: Bearer <service-role-key>" \
     -H "Content-Type: application/json" \
     -d '{"type": "recovery", "email": "user@example.com"}'
   ```

### For Bulk Password Reset
If multiple accounts are compromised, force password resets in bulk:
```sql
-- Flag accounts for forced password reset
-- After this, notify users via Resend to reset their passwords
SELECT au.email, p.full_name
FROM auth.users au
JOIN public.profiles p ON p.id = au.id
WHERE au.id IN (
  -- List of compromised user IDs
  'uuid-1', 'uuid-2', 'uuid-3'
);
```

Then send password reset emails through Resend with a clear explanation of why the reset is required.

---

## Audit Log Investigation

### Check for Unauthorized Data Access
```sql
-- Review audit log for actions by the compromised user
SELECT
  action,
  entity_type,
  entity_id,
  metadata,
  created_at
FROM public.audit_logs
WHERE actor_id = '<compromised-user-id>'
  AND created_at > '<incident-start-time>'
ORDER BY created_at DESC;
```

### Check for Privilege Escalation
```sql
-- Look for role changes in audit logs
SELECT *
FROM public.audit_logs
WHERE action IN ('role_updated', 'profile_updated')
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Check for Unauthorized Account Creation
```sql
-- Find recently created accounts
SELECT
  au.id,
  au.email,
  au.created_at,
  p.role,
  p.full_name
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE au.created_at > NOW() - INTERVAL '7 days'
ORDER BY au.created_at DESC;
```

### Check for Unusual API Patterns
Review Sentry for:
- Filter by user ID to see all their requests
- Look for 403/401 errors that indicate probing of unauthorized endpoints
- Check for bulk data exports (large response payloads from `/api/people`, `/api/documents`)

---

## Communication to Affected Users

### Single Account Compromise

Send via Resend:

> **Subject:** Important: Your Crew Hub Account Security
>
> Hi [Name],
>
> We detected unusual activity on your Crew Hub account on [date]. As a precaution, we have temporarily disabled your account and reset your session.
>
> **What you need to do:**
> 1. Click the password reset link below to set a new password
> 2. Review your recent activity after logging back in
> 3. Report anything suspicious to your administrator
>
> [Password Reset Link]
>
> If you did not initiate any unusual activity, please notify your manager or HR administrator immediately.

### Systemic Breach

Coordinate with leadership before sending. Include:
- Clear description of what happened (without exposing technical details that could aid attackers)
- What data may have been accessed
- What actions the company has taken
- What users need to do (reset passwords, review activity)
- Contact information for questions

---

## Root Cause Analysis Checklist

After the incident is contained, work through these items:

### Authentication Layer
- [ ] Were Supabase Auth credentials (anon key, service role key) exposed in client-side code or logs?
- [ ] Was the JWT secret compromised or using a weak/default value?
- [ ] Are Supabase Auth email templates configured to prevent phishing?
- [ ] Was MFA enabled for the compromised accounts? (Note: MFA is not yet implemented)
- [ ] Were there any recent changes to Supabase Auth settings?

### Authorization Layer (RLS)
- [ ] Are Row Level Security policies enabled on all tables containing sensitive data?
- [ ] Were any RLS policies recently modified or temporarily disabled?
- [ ] Does the API route that was exploited properly validate user roles before executing queries?
- [ ] Are service-role-key calls limited to server-side code only?

### Application Layer
- [ ] Were any API routes missing auth middleware?
- [ ] Was role-based access control enforced at both API and database levels?
- [ ] Were there any recent deployments that may have introduced a vulnerability?
- [ ] Are all `~160 API routes` using consistent auth patterns?

### Infrastructure Layer
- [ ] Are environment variables properly scoped (production vs preview vs development)?
- [ ] Was the Supabase service role key exposed in any client bundle?
- [ ] Are Vercel deployment logs accessible only to authorized team members?
- [ ] Is the `CRON_SECRET` value strong and not shared across environments?

### Process
- [ ] How was the incident detected? Can detection be automated/improved?
- [ ] How long was the exposure window (time between compromise and detection)?
- [ ] Were audit logs sufficient to reconstruct the full timeline?
- [ ] What monitoring or alerts would have caught this sooner?
