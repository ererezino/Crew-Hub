# Incident: Production profile resolution broken by missing migration

**Date**: 2026-03-14
**Duration**: ~15 minutes
**Severity**: P0 — all users affected
**Status**: Resolved

## What happened

After pushing 4 commits for Phase 1 (org delegation model) to `main`, Vercel
auto-deployed to production (`crew.useaccrue.com`). The code in
`lib/auth/session.ts` now includes `team_lead_id` in the SELECT query against
`profiles`. However, the migration that adds `team_lead_id` to the `profiles`
table had only been applied to the **staging** Supabase project
(`rvcpvfmkjadbkvhmiklu`), not the **production** Supabase project
(`xmeruhyybvyosqxfleiu`).

This caused the session profile query to fail for every user. The app fell
through to its "no profile found" fallback, showing:
- "Your account is authenticated, but no profile record was found yet."
- Generic name "User" and role "Employee"

## Root cause

**Code was deployed before the required migration was applied to production.**

The deployment pipeline (push to `main` → Vercel auto-deploy) has no gate that
verifies database schema compatibility. The migration was applied to staging
using `supabase db push --linked`, but the Supabase CLI was linked to the
staging project, not production.

## Resolution

1. Applied migration `20260314000000_org_delegation_model.sql` to production
   Supabase (`xmeruhyybvyosqxfleiu`) via `supabase db push --linked` after
   temporarily re-linking the CLI to the production project.
2. Verified production schema: `profiles.team_lead_id`, `approval_delegates`,
   and `function_owners` all return HTTP 200.
3. Verified production profile resolution: session-equivalent SELECT for
   `zino@useaccrue.com` returns full profile with all fields.
4. Re-linked CLI to staging project.

## Safeguard added

**Startup schema compatibility check** in `instrumentation.ts`:

- On app startup, queries each required column/table via the Supabase REST API.
- If a required column is missing:
  - **Production**: throws a fatal error, crashing the deploy. Vercel will not
    route traffic to a crashed deployment, keeping the previous working version
    active.
  - **Dev/preview**: logs an error but does not crash, allowing local
    development before migrations are applied.
- The `REQUIRED_SCHEMA` array should be updated whenever a migration adds
  columns that the session layer depends on.

This ensures that even if code is pushed before a migration, the production
deployment will fail fast rather than serving broken responses.

## Process changes

1. **Migration-first deploy order**: Always apply migrations to production
   before pushing code that depends on new schema. The release checklist
   (`docs/phase1-staging-verification.md`) now documents this as a prerequisite.
2. **Schema check at startup**: `instrumentation.ts` now validates required
   columns exist before accepting traffic.
3. **No implicit production deploys**: Future schema-dependent changes should
   use a feature branch + PR, not direct pushes to `main`, so the migration
   can be applied in the window between merge and deploy.
