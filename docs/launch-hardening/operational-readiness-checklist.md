# Operational Readiness Checklist

## Health & Monitoring
- [x] Health endpoint (liveness) — `GET /api/health`
- [x] Health endpoint (readiness with DB check) — checks DB latency, env vars
- [x] Structured logging (JSON format) — `lib/logger.ts` with PII redaction
- [x] Correlation/request IDs in logs — `X-Request-Id` generated in middleware
- [x] PII scrubbing in logs — REDACTED_FIELDS set for passwords, tokens, SSN, etc.
- [x] Sentry error tracking — configured for server, client, and edge
- [ ] Monitoring alerts defined — Sentry alert rules needed
- [ ] Uptime monitoring configured — external uptime check recommended

## Security
- [x] Temporary reset endpoint removed — SEC-001
- [x] MFA enforced for admin roles — SUPER_ADMIN and HR_ADMIN require TOTP
- [x] Durable rate limiting — DB-backed for critical auth paths
- [x] Account lockout / abuse defense — 5 attempts / 15 min window / 15 min lockout
- [x] Session invalidation on password change — global signOut
- [x] HSTS header — 2 years, includeSubDomains, preload
- [x] CSP hardened — no unsafe-eval, documented unsafe-inline exception
- [x] Role escalation paths blocked — SUPER_ADMIN assignment restricted
- [x] Failed login tracking — durable DB-backed with audit logging
- [x] Upload validation (magic bytes, size, type) — `lib/security/upload-signatures.ts`
- [x] Secrets not in logs — REDACTED_FIELDS in structured logger
- [x] Cookie secure flags — managed by Supabase SSR library

## Deployment
- [x] Environment variable validation at startup — `instrumentation.ts`
- [x] Rollback playbook documented — `docs/launch-hardening/rollback-plan.md`
- [x] Deploy process documented — Vercel Git-based deployment
- [ ] Branch protection configured — requires GitHub repo settings
- [x] CI gates: lint + typecheck + test + build — `.github/workflows/ci.yml`

## Cron Jobs
- [x] All cron endpoints authenticated via CRON_SECRET
- [x] Retry discipline — cron helper with `withRetry` available
- [x] Idempotent execution — cron jobs check for existing data before creating
- [x] Failure alerting — Sentry captures unhandled errors, structured logging

## Data & Privacy
- [x] Privacy policy page — `/privacy`
- [x] Terms of service page — `/terms`
- [x] Data retention model documented — in privacy policy section 4
- [x] Export/delete rights flow — `GET /api/v1/me/data-export`
- [x] Support/report issue path — SupportLink component in app shell

## Product Truthfulness
- [x] Disabled features labeled — feature state system in `lib/feature-state.ts`
- [x] Payment/payroll scope honest — disbursement UNAVAILABLE, payroll LIMITED_PILOT
- [x] No misleading success states — verified across core modules
- [x] Destructive actions have confirmations — `useConfirmAction` hook
- [x] Empty/loading/error states polished — verified in core flows

## Testing
- [x] Unit tests for pure logic — 202+ tests
- [x] Integration-style tests for auth, role, upload, feature gates
- [x] CI gates on all test suites
- [x] Static code audits for security patterns
- [ ] E2E browser tests — recommended for post-launch regression suite
