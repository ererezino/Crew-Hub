# Risk Register

## March 9, 2026 Update

### RESOLVED (This Cycle)

#### VERIFY-003: Expense Approval Browser Audit False Partial on Empty Queue
- **Area**: Browser verification harness (`docs/launch-hardening/browser-audit.mjs`)
- **Risk**: False-negative/partial signal when approvals queue is legitimately empty
- **Impact**: Misleading release-readiness reporting
- **Status**: RESOLVED
- **Resolution**: Added explicit empty-queue pass conditions for expense approvals.

#### UX-004: Login Footer Legal/Support Visibility
- **Area**: Public login page flow
- **Risk**: Legal/support links not fully visible in login audit flow
- **Impact**: Trust/compliance UX gap on public auth entry point
- **Status**: RESOLVED
- **Resolution**: Added visible support contact + privacy/terms links on `/login`; verification check now passes.

#### VERIFY-004: Authenticated Browser Rerun on OTP-Only Login UX
- **Area**: Browser end-to-end verification
- **Risk**: OTP-only login refactor previously blocked authenticated rerun without manual OTP values.
- **Impact**: Previously left a runtime confidence gap in launch-critical authenticated journeys.
- **Status**: RESOLVED
- **Resolution**: Browser audit harness now auto-bootstraps TOTP for `@accrue.test` audit users using system-password + MFA enroll/verify, and full rerun completed with `11 pass / 0 fail` on `2026-03-09`.

## RESOLVED

### SEC-001: Unauthenticated Admin Password Reset Endpoint
- **Route**: `/api/v1/tmp-admin-reset` + `/tmp-reset` page
- **Risk**: Anyone could reset any user's password without authentication
- **Impact**: Complete account takeover
- **Status**: RESOLVED
- **Resolution**: Both files deleted. Verified route returns 404. Regression test added.

### SEC-002: Rate Limiting Not Durable (In-Memory on Vercel)
- **Route**: All rate-limited endpoints
- **Risk**: Rate limits reset on every cold start; no cross-instance state
- **Impact**: Brute force attacks possible across instances
- **Status**: RESOLVED
- **Resolution**: Hybrid approach implemented:
  - In-memory rate limiting remains for fast-path edge middleware (first line of defense)
  - Durable DB-backed rate limiting (`rate_limit_entries` table) added for critical server-side routes
  - Login-check endpoint: 20 requests/min per IP (durable)
  - Password change: 5 attempts/5 min per user+IP (durable)
  - Account lockout: 5 failed logins/15 min triggers 15 min lockout (durable, separate system)

### SEC-003: No Account Lockout / Abuse Defense
- **Route**: Login flow
- **Risk**: Unlimited login attempts possible
- **Impact**: Credential stuffing / brute force
- **Status**: RESOLVED
- **Resolution**: Durable Supabase-backed `failed_login_attempts` + `account_lockouts` tables. 5 attempts in 15 min triggers 15 min lockout. Login page integrates pre-check, fail recording, and success clearing.

### SEC-004: No MFA for Admin Roles
- **Risk**: Admin accounts protected only by password
- **Impact**: Single-factor compromise = full admin access
- **Status**: RESOLVED
- **Resolution**: TOTP MFA enforcement for SUPER_ADMIN and HR_ADMIN roles. Middleware redirects unenrolled admins to /mfa-setup. API at /api/v1/me/mfa handles enrollment/verification/unenrollment. Supabase built-in MFA used.

### SEC-005: CSP Allows unsafe-inline and unsafe-eval
- **Risk**: XSS attack surface
- **Impact**: Script injection possible
- **Status**: RESOLVED (with documented exception)
- **Resolution**: `unsafe-eval` removed. `unsafe-inline` retained for `script-src` and `style-src` — this is a documented Next.js framework limitation. Next.js uses inline scripts for hydration and Tailwind/CSS-in-JS requires inline styles. No practical nonce-based alternative exists for Next.js App Router at this time.

### SEC-006: No HSTS Header
- **Risk**: Downgrade attacks possible
- **Impact**: MITM interception
- **Status**: RESOLVED
- **Resolution**: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` applied to all responses.

### SEC-007: No Session Invalidation on Password Change
- **Route**: `/api/v1/me/password`
- **Risk**: Old sessions remain valid after password change
- **Impact**: Compromised session persists
- **Status**: RESOLVED
- **Resolution**: Global signOut via Supabase admin API after password change. User must re-authenticate. Audit logged.

### SEC-008: Role Escalation Inconsistency (People Routes)
- **Route**: POST `/api/v1/people` vs PUT `/api/v1/people/[id]`
- **Risk**: HR_ADMIN could escalate roles to SUPER_ADMIN
- **Impact**: Privilege escalation
- **Status**: RESOLVED
- **Resolution**: Both POST and PUT now check: only SUPER_ADMIN can assign SUPER_ADMIN role. Last SUPER_ADMIN removal blocked.

### OPS-001: No Health Endpoint
- **Status**: RESOLVED
- **Resolution**: `GET /api/health` returns liveness/readiness with DB latency check, env var validation, uptime, and commit SHA.

### OPS-002: No Structured Logging
- **Status**: RESOLVED
- **Resolution**: JSON structured logger (`lib/logger.ts`) with PII redaction, severity levels, and configurable min level.

### OPS-003: No Correlation/Request IDs
- **Status**: RESOLVED
- **Resolution**: Middleware generates `X-Request-Id` (UUID) for every request. Set on all responses via security headers.

### OPS-005: No Startup Env Validation
- **Status**: RESOLVED
- **Resolution**: `instrumentation.ts` validates required env vars at startup and logs structured error for missing ones.

### TEST-001: Minimal Test Coverage
- **Status**: RESOLVED
- **Resolution**: 202+ tests across 14 test suites covering security, operations, privacy, product truthfulness, and production hardening features.

### TEST-002: CI Only Runs Lint + Build
- **Status**: RESOLVED
- **Resolution**: CI pipeline: lint → typecheck → test → build. Build depends on all three passing.

### LEGAL-001: No Privacy Policy
- **Status**: RESOLVED
- **Resolution**: `/privacy` page with 7 sections covering GDPR rights, data collection, storage, retention, sharing, and contact.

### LEGAL-002: No Terms of Service
- **Status**: RESOLVED
- **Resolution**: `/terms` page with 8 sections covering acceptance, service description, accounts, acceptable use, data ownership, availability, liability, and contact.

### LEGAL-003: No Data Export/Delete Rights Flow
- **Status**: RESOLVED
- **Resolution**: `GET /api/v1/me/data-export` exports all user data across 7 tables. Audit logged. Admin-mediated deletion documented in privacy policy.

### TRUST-001: No Support/Report Issue Path
- **Status**: RESOLVED
- **Resolution**: SupportLink component with help modal in app shell sidebar. Covers: report issue, feature questions, account/access, data/privacy.

## ACCEPTED RISKS

### SEC-009: CSRF Allows Requests Without Origin/Referer
- **Route**: All mutation endpoints
- **Risk**: Non-browser requests bypass CSRF entirely
- **Impact**: API abuse from scripts
- **Status**: ACCEPTED
- **Rationale**: This is standard behavior — CSRF protection targets browser-based attacks. Server-to-server API calls legitimately omit these headers. Authentication (Supabase session tokens) is the primary defense for API access. Rate limiting provides secondary protection.

### SEC-010: CSP unsafe-inline for scripts
- **Risk**: Reduces XSS mitigation compared to strict CSP
- **Impact**: If an attacker can inject HTML, inline script execution is possible
- **Status**: ACCEPTED
- **Rationale**: Next.js App Router framework limitation. No practical nonce-based alternative. Other XSS mitigations (input validation, Zod schemas, React's built-in escaping, frame-ancestors 'none') reduce residual risk.

### VERIFY-001: Load Test Validates Performance Thresholds
- **Status**: RESOLVED
- **Resolution**: k6 load test executed March 8, 2026. All 4 thresholds passed: HTTP p95=264ms, login p95=266ms, read p95=272ms, write p95=271ms. Rate limiting and account lockout verified working under load.

### VERIFY-002: Browser Walkthrough Validates All Launch Flows
- **Status**: RESOLVED
- **Resolution**: Full browser walkthrough executed March 8, 2026. 48 tests across 18 categories, all passing. RBAC verified across employee and admin roles. Feature states verified honest. 3 non-blocking findings identified (no approval confirmation dialog, catch-all shows "Coming soon" instead of 404, stale approval tab counts).

## NEW FINDINGS (from verification, non-blocking)

### UX-001: No Confirmation Dialog on Approval Actions
- **Route**: Approvals page
- **Risk**: Manager accidentally approves/rejects a request with no undo
- **Impact**: Unintended approval or rejection
- **Status**: ACCEPTED (post-launch fix)
- **Rationale**: The action works correctly. Adding a confirmation modal is a UX improvement, not a security or correctness issue.

### UX-002: Catch-All Route Shows "Coming Soon" Instead of 404
- **Route**: Any nonexistent URL
- **Risk**: Users think nonexistent features are upcoming
- **Impact**: False expectations
- **Status**: ACCEPTED (should fix before or immediately after launch)
- **Rationale**: Misleading but not harmful. Fix is ~15 minutes of work.

### UX-003: Approval Tab Counts Stale After Action
- **Route**: Approvals page
- **Risk**: Tab shows incorrect count until refresh
- **Impact**: Cosmetic confusion
- **Status**: ACCEPTED (post-launch fix)

## DEFERRED (Non-Launch-Blocking)

### OPS-004: Cron Retry Discipline
- **Status**: MITIGATED
- **Resolution**: Cron helper utilities created (`lib/cron/helpers.ts`) with `withRetry` for exponential backoff and `withCronErrorHandling` for structured logging. Available for cron handlers to adopt. Existing cron handlers use fire-and-forget for notifications which is acceptable since notification failures are non-critical.

### OPS-006: No Rollback Playbook
- **Status**: RESOLVED
- **Resolution**: `docs/launch-hardening/rollback-plan.md` with Vercel rollback, DB migration considerations, feature flag rollback, and post-rollback verification.
