# Crew Hub -- North Star

## Product
- Crew Hub: internal employee ops platform for Accrue, a distributed 
  multi-country fintech team.
- Repo: crew-hub
- UI branding: "Crew Hub" everywhere. Never "Accrue Hub".
- Users: Accrue team across Nigeria, Ghana, Kenya, South Africa, Canada.
- Modules: People, Onboarding, Time Off, Documents, Payroll, 
  Expenses, Performance, Compliance, Analytics, Announcements.

## Roles (RBAC, server-enforced via roles array)
- EMPLOYEE: view own data, submit requests
- MANAGER: above + view direct reports, approve leave/expenses
- HR_ADMIN: above + manage all employees, run onboarding, 
  manage documents, view compensation (cannot approve payroll)
- FINANCE_ADMIN: initiate payroll runs, manage deduction rules, 
  first-approve payroll, manage expense reimbursements, 
  view compensation
- SUPER_ADMIN: full access, final payroll approval, system config, 
  role management

Implementation: store as TEXT[] on profiles. A person can hold 
multiple roles. Permission checks use hasRole(user, 'ROLE'), 
not equality. Double-approval still requires two different people.

## Payroll Policy
- Employment types: contractor, full_time, part_time
- Contractors: paid in USD. Crew Hub does NOT calculate or 
  withhold taxes. Payslips are optional; default is a payment 
  statement. Contractor handles own taxes.
- Employees (future): paid in local currency with statutory 
  deductions by country when enabled.
- Each person has a payroll_mode:
  - contractor_usd_no_withholding (default for contractors)
  - employee_local_withholding (future, when country engine enabled)
- Current state: ALL team members are contractors paid in USD 
  with zero withholding. The system must be structured so that 
  flipping payroll_mode for an employee and enabling a country 
  engine activates full withholding without restructuring.

## Tech Stack
- Next.js 14+ App Router, TypeScript strict, Tailwind CSS, shadcn/ui
- Supabase (PostgreSQL + Auth + RLS + Storage + Realtime)
- Resend (transactional email)
- Vercel (hosting + CI/CD)
- React Query for server state, Zustand for client state
- React Hook Form + Zod for all forms
- @react-pdf/renderer for PDF generation
- Recharts for analytics charts (install in Phase 4.2)

## API Conventions
- All routes under /api/v1/
- Response shape: { data, error, meta }
- Cursor-based pagination for all lists
- Zod validation on every endpoint
- Rate limiting on sensitive endpoints (auth, payments, payroll)
- Proper HTTP status codes

## Database Principles
- org_id on every table (multi-tenancy ready)
- deleted_at TIMESTAMPTZ for soft delete on all records
- audit_log table for all mutations
- RLS policies on EVERY table, no exceptions
- Money: BIGINT in smallest currency unit + VARCHAR(3) currency
- JSONB for flexible/extensible fields
- Proper indexes on frequently queried columns

## Security
- Auth middleware on all routes (except /login)
- RLS on every Supabase table
- AES-256 encryption for sensitive fields at application level
- CSP headers, CSRF protection on mutations
- Secure file upload with type/size validation
- Admin action IP logging

## Design Tokens (SINGLE SOURCE OF TRUTH)

### Core Palette
Primary:          #0F172A
Accent:           #22C55E
Accent hover:     #16A34A
Accent subtle:    #F0FDF4
Accent dark mode: #4ADE80

### Backgrounds
Light: #FFFFFF / #F8FAFC / #F1F5F9
Dark:  #0F172A / #1E293B / #334155

### Text
Light: #0F172A / #475569 / #94A3B8 / #CBD5E1
Dark:  #F8FAFC / #94A3B8 / #64748B / #475569

### Borders
Light: #E2E8F0 (default), #F1F5F9 (subtle)
Dark:  #334155 (default), #1E293B (subtle)

### Status Colors (each has bg, text, border)
Success/Active:    bg #F0FDF4, text #15803D, border #BBF7D0
Warning:           bg #FFFBEB, text #A16207, border #FDE68A
Error/Rejected:    bg #FEF2F2, text #B91C1C, border #FECACA
Info:              bg #EFF6FF, text #1D4ED8, border #BFDBFE
Pending:           bg #F5F3FF, text #6D28D9, border #DDD6FE
Draft:             bg #F8FAFC, text #475569, border #E2E8F0
Processing:        bg #F0F9FF, text #0369A1, border #BAE6FD

Dark mode status: same hues but lower saturation backgrounds 
that work on dark surfaces. Define as CSS variables.

### Typography
Fonts: Geist (body), Geist Mono (numbers/data/code)
Scale: 12px caption, 14px body, 16px section title, 20px page title
All weights: 400 normal, 600 semibold
Line heights: 1.25 headings, 1.5 body

### Spacing & Shape
Radius: 6px default, 8px cards, 12px modals
Transitions: 150ms hover, 200ms panels

Do NOT use #1a1a2e anywhere. Primary is #0F172A.
Do NOT hardcode colors outside these tokens. Every color in the 
app must trace back to a token defined here or a CSS variable 
derived from one.
