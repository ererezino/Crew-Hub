# Auth Reset Safety (Dev vs Live)

## Why this exists
If local/dev and production point to the same Supabase project, MFA/password resets affect the same user record everywhere.

## Required environment separation
1. Production runtime must point to production Supabase.
2. Local/dev runtime should point to a different Supabase project.
3. Set `PRODUCTION_SUPABASE_PROJECT_REF` in all environments.

## Guard rails
- `AUTH_PROD_PROJECT_GUARD=true` blocks auth mutations from non-production runtimes when they point to production Supabase.
- `AUTH_ALLOW_MUTATIONS_AGAINST_PROD_SUPABASE=true` is an explicit override (use only for intentional live operations).

## Safe MFA reset command
Use:

```bash
npm run auth:reset-mfa -- --email user@company.com --app-url http://localhost:3000 --expected-project-ref <dev-project-ref>
```

For intentional live reset:

```bash
npm run auth:reset-mfa -- --email user@company.com --app-url https://crew.useaccrue.com --expected-project-ref <prod-project-ref> --allow-prod-project
```

If `--allow-prod-project` is not provided, resets against the production Supabase project are blocked.
