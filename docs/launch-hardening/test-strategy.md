# Test Strategy

## Current State (Baseline)

- **Test framework**: Vitest 4.0.18
- **Total tests**: 45 (44 passing, 1 failing)
- **Failing test**: `api-zod-audit.test.ts` - correctly catches that `tmp-admin-reset` route lacks Zod validation
- **Coverage areas**: Payroll calculation, idempotency, auth guards (static analysis), survey anonymity, security remediation (static analysis), Zod audit (static analysis)
- **Integration tests**: 0
- **E2E tests**: 0
- **Browser automation**: Puppeteer available in devDependencies but no E2E test files

## Target State

### Unit Tests (Vitest)
- Auth helpers: session, roles, password generation
- Rate limiter logic (pure function tests)
- CSP generation
- CSRF validation
- Upload signature validation
- Feature state helpers
- Currency formatting
- Date/time utilities
- Idempotency logic
- Payroll calculation engine
- Audit log helpers
- Error message humanization

### Integration Tests (Vitest + Supabase test client)
- Login/session behavior
- Password change + session invalidation
- Role creation/update restrictions
- RBAC enforcement on all admin routes
- Document upload validation
- Leave request lifecycle
- Expense lifecycle
- Onboarding instance creation
- Performance review flow
- Cron endpoint authentication
- Health endpoint
- Rate limit behavior

### E2E Tests (Puppeteer)
- Login / logout flow
- Password reset flow
- Admin user management
- Time-off submit + approve
- Expense submit + approve
- Document upload + download
- Onboarding completion
- Disabled feature honesty verification
- Support/report path accessibility
- Privacy/terms page accessibility

## CI Gates (Target)
1. Lint (existing)
2. TypeCheck (`tsc --noEmit`)
3. Unit tests (`vitest run`)
4. Build (existing)
