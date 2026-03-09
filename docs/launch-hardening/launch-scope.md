# Launch Scope

## IN SCOPE (Launch-Ready)

| Module | Feature State | Notes |
|--------|---------------|-------|
| Dashboard | LIVE | Full launch |
| Time Off | LIVE | Full launch |
| Documents | LIVE | Full launch |
| Approvals | LIVE | Full launch |
| People (Directory) | LIVE | Full launch |
| Onboarding | LIVE | Full launch |
| Expenses | LIVE | Full launch |
| Compliance | LIVE | Full launch |
| Time & Attendance | LIVE | Full launch |
| Notifications | LIVE | Full launch |
| Announcements | LIVE | Full launch |
| Compensation | LIVE | Full launch |
| My Pay | LIVE | Full launch |
| Scheduling | LIMITED_PILOT | Auto-generate is SETUP_REQUIRED |
| Payroll | LIMITED_PILOT | Nigeria engine only; disbursement UNAVAILABLE |
| Performance | LIMITED_PILOT | Core review cycles |
| Team Hub | LIMITED_PILOT | Wiki/knowledge base |
| Analytics | ADMIN_ONLY | Admin dashboards only |
| Auth & Account Flows | LIVE | Login, password reset, change password, sessions |
| Admin User Management | LIVE | Full RBAC management |
| Settings | LIVE | Profile, org, notifications |

## OUT OF SCOPE (Deferred)

| Module | Feature State | Honesty Requirement |
|--------|---------------|---------------------|
| Payroll Disbursement | UNAVAILABLE | Must not allow real payment execution |
| Payroll Withholding (GH, KE, ZA, CA) | COMING_SOON | Must label as "Coming Soon" |
| Learning | UNAVAILABLE | Hidden from nav; direct URL shows preview banner |
| Signatures | UNAVAILABLE | Hidden from nav; direct URL shows preview banner |
| Surveys | UNAVAILABLE | Hidden from nav; direct URL shows preview banner |

## Truthfulness Requirements

1. Payment/disbursement buttons must be disabled or absent with clear messaging
2. Payroll pages must show LIMITED_PILOT banner explaining scope
3. Multi-country payroll engines must show COMING_SOON labels
4. UNAVAILABLE modules must show "Preview" banner if accessed via direct URL
5. No success state should imply money was transferred when it was not
6. Simulation-mode features must display SIMULATION banner
