# Crew Hub - Product Overview

Crew Hub is a comprehensive employee operations platform that manages every aspect of workforce operations — from onboarding a new hire to running payroll, tracking time off, managing compliance, and everything in between.

Built for multi-country teams, it provides self-service tools for employees, approval workflows for managers, and administrative control for HR and finance teams.

---

## Roles & Access Control

Crew Hub operates with six hierarchical roles, each unlocking progressively more capabilities:

| Role | Access Level |
|------|-------------|
| **Employee** | Self-service: own pay, time off, documents, expenses, time tracking, learning |
| **Team Lead** | Employee access + team approvals, limited onboarding, crew member visibility |
| **Manager** | Team Lead access + full team management, approvals, scheduling |
| **HR Admin** | Manager access + HR operations, learning, compliance, performance reviews |
| **Finance Admin** | Manager access + payroll, payments, expense finance approvals, compensation |
| **Super Admin** | Full access + audit log, roles & access configuration, all admin functions |

Access can be further customized per individual user through per-user navigation and widget overrides, allowing exceptions to default role-based permissions.

---

## Core Modules

### 1. Dashboard

A role-aware home screen that surfaces the most relevant information for each user:

- **Employees** see pending tasks, upcoming time off, recent payslips, and announcements.
- **Managers** see team metrics, pending approvals, and onboarding status.
- **Admins** see organization-wide KPIs, headcount trends, and compliance alerts.

Quick-action cards link to common tasks. A command palette (Cmd+K) provides fuzzy search across routes, people, documents, and policies.

### 2. People / Crew Members

Central directory of all employees with:

- **Profile management**: Name, email, avatar, department, title, country, timezone, phone, start date, manager assignment.
- **Employment details**: Full-time, part-time, or contractor status. Active, inactive, onboarding, or offboarding states.
- **Privacy settings**: Employees control visibility of their email, phone, department, bio, and interests.
- **Invite & onboarding flow**: HR sends an invite, the system provisions credentials, and the employee receives a welcome email.
- **Offboarding**: Initiate offboarding workflows with task tracking.
- **Presence tracking**: See who is currently online.

### 3. Time Off

Complete leave management system:

- **Leave types**: Annual leave, sick leave, personal days, birthday leave, and unpaid personal days.
- **Request & approval**: Employees submit requests; managers approve or reject. Birthday and sick leave can be auto-approved.
- **Balance tracking**: Configurable accrual types — annual upfront, monthly, quarterly, or manual.
- **Team calendar**: Visual calendar showing who is off and when.
- **AFK status**: Automatic away-from-keyboard status during approved leave.
- **Leave policies**: Country-specific policies governing entitlements and carryover.
- **Birthday leave**: Auto-granted on the employee's birthday (with weekday adjustment if it falls on a weekend).

### 4. My Pay

Employee compensation visibility:

- **Payslips**: View and download payment statements as PDFs.
- **Compensation details**: Base salary, allowances, and equity grants.
- **Payment methods**: Manage payout preferences — bank transfer, mobile money, or Crew tag.
- **Payment holds**: Track any holds on upcoming payments.

### 5. Documents

Document management for both employees and administrators:

- **Employee uploads**: Self-service upload for ID documents and tax forms.
- **Admin uploads**: HR can upload policies, contracts, compliance documents, and payroll statements.
- **Expiry tracking**: Automatic reminders 30 days before document expiry.
- **Signed download URLs**: Time-limited, secure download links.
- **Policy acknowledgments**: Track which employees have acknowledged key documents.

### 6. Expenses

Two-stage expense management workflow:

- **Submission**: Employees submit expenses with receipt uploads, amounts, categories, and descriptions.
- **Manager approval**: Direct manager reviews and approves or rejects.
- **Finance approval**: Finance team performs secondary review for approved expenses.
- **Reimbursement tracking**: Track expenses through pending, manager-approved, approved, and reimbursed states.
- **Reports & analytics**: Filter and analyze expense data by department, category, date range, and status.

### 7. Time & Attendance

Clock-in/clock-out system with timesheet management:

- **Time entries**: Record work hours via web, mobile, or kiosk interfaces.
- **Timesheets**: Aggregate time entries into weekly/biweekly timesheets for submission.
- **Manager approval**: Submitted timesheets go through manager approval before locking.
- **Time policies**: Country-specific rules for weekly targets, overtime, break requirements.
- **Rounding rules**: Configurable rounding to nearest 5, 15, or 30 minutes.

### 8. Approvals Hub

Centralized queue for managers to handle all pending approvals in one place:

- Time off requests
- Expense submissions
- Timesheet submissions
- Workflow approvals

### 9. Payroll

Multi-step payroll processing with staged approvals:

- **Payroll runs**: Create runs by period with employee selection.
- **Calculation**: Compute gross pay, deductions (tax, pension, social insurance), and net pay using country-specific engines (Nigeria implemented).
- **Adjustments**: Add per-employee allowances or deductions to individual payroll items.
- **Staged approval**: First approval (Finance) followed by final approval (HR/Super Admin).
- **Payslip generation**: Automatically generate PDF payment statements.
- **Payslip distribution**: Send payslips to employees via email.
- **Status tracking**: Draft, calculated, pending first/final approval, approved, processing, completed.

### 10. Payments

Payment execution and tracking:

- **Multi-provider support**: Cashramp (primary), Wise (cross-border), and a mock provider for testing.
- **Payment batches**: Group payments for batch processing.
- **Idempotency**: Duplicate-prevention system ensures no double payments.
- **Delivery tracking**: Monitor payment status through to completion.
- **Webhook handling**: Receive real-time status updates from payment providers.
- **Payment ledger**: Complete record of all payment transactions.

### 11. Compensation Management

Comprehensive compensation administration:

- **Salary records**: Track base salary with currency and effective dates.
- **Allowances**: Housing, transport, meal, and custom allowance types.
- **Equity grants**: Stock options and RSU tracking with vesting schedules.
- **Compensation bands**: Market-based salary benchmarking by role, level, and location.
- **Compa-ratio alerts**: Flag employees who fall outside expected compensation ranges.
- **Payroll modes**: Contractor USD (no withholding), employee local currency (with withholding), employee USD (with withholding).

### 12. Performance Reviews

Structured performance management:

- **Review cycles**: Quarterly, annual, and probation review periods.
- **Self-reviews**: Employees complete self-assessments before a deadline.
- **Manager reviews**: Managers evaluate direct reports with ratings and comments.
- **Goal tracking**: Set and monitor individual performance goals.
- **Review templates**: Standardized review forms for consistency.
- **Calibration**: Cross-team rating fairness tools to ensure equitable evaluations.
- **Reminders**: Automatic notifications 2 days before self-review deadlines.

### 13. Onboarding

Structured onboarding for new hires:

- **Onboarding templates**: Predefined task lists by role or department.
- **Instance tracking**: Launch onboarding plans for individual employees.
- **Task management**: Track completion of each onboarding task.
- **Blocker notifications**: Alert managers and task owners when progress stalls.
- **Employee view**: New hires see their own onboarding checklist and progress.

### 14. Scheduling

Shift scheduling for team operations:

- **Schedule creation**: Build weekly or custom-period schedules for teams.
- **Shift management**: Assign employees to shifts with start/end times.
- **Auto-generation**: Automatically generate shifts from templates.
- **Publishing**: Publish schedules to notify team members.
- **Open shifts**: Post unfilled shifts that employees can claim.
- **Shift swaps**: Employees request swaps; managers approve or deny.
- **Templates**: Save and reuse common shift patterns.

### 15. Learning

Employee development and training:

- **Course creation**: Build courses with modules and content.
- **Assignments**: Bulk-assign mandatory or optional courses to employees.
- **Progress tracking**: Monitor completion rates across the organization.
- **Certificates**: Auto-generate completion certificates.
- **Learning reports**: Track course completion rates and learning ROI.

### 16. Compliance

Regulatory compliance tracking:

- **Deadlines**: Country-specific compliance deadlines by requirement type.
- **Status tracking**: Monitor compliance items through pending, in-progress, completed, and overdue states.
- **Proof documents**: Attach supporting documentation to compliance items.
- **Automated reminders**: 7-day warning, day-of alert, and automatic overdue marking.
- **Country support**: Compliance requirements configured per country.

### 17. Analytics

Workforce analytics and reporting:

- **Headcount trends**: Track employee growth, turnover, and departmental distribution.
- **Time off utilization**: Analyze leave usage patterns across the organization.
- **Expense analysis**: Spending trends by department, category, and period.
- **Payroll metrics**: Cost analysis and compensation distribution.
- **Visual dashboards**: Charts and metric cards for at-a-glance insights.

### 18. Team Hub

Department knowledge base:

- **Hubs**: Create department-specific or organization-wide knowledge bases.
- **Sections**: Organize content into logical sections within each hub.
- **Page types**: Documents, runbooks, reference lists, tables, contact lists, and link collections.
- **Cover images**: Optional visual headers for pages.
- **Visibility controls**: Department-only, organization-wide, or private access.
- **Pinning & sorting**: Highlight important pages and control display order.

### 19. Announcements

Company-wide communication:

- **Create & publish**: HR and admins publish announcements to the organization.
- **Read tracking**: Monitor which employees have read each announcement.
- **Dismiss tracking**: Employees can dismiss announcements they have reviewed.
- **Holiday announcements**: Auto-publish country-specific public holiday notices.
- **Leave start announcements**: Notify the team when an employee begins approved leave.

### 20. Notifications

Unified notification system:

- **In-app notifications**: Bell icon with unread count and notification center.
- **Email notifications**: Configurable email delivery for different event types.
- **Preferences**: Employees control which notifications they receive via email vs. in-app.
- **Read/delete management**: Mark notifications as read or remove them.

### 21. Signatures (Upcoming)

Electronic signature workflows:

- **Signature requests**: Send documents to one or more signers.
- **Signer management**: Track which signers have completed their signatures.
- **Status tracking**: Pending, partially signed, completed, voided, or expired.

### 22. Surveys (Upcoming)

Employee engagement measurement:

- **Survey types**: Engagement, pulse, and exit surveys.
- **Anonymous responses**: Protect employee privacy while gathering honest feedback.
- **Organizational isolation**: Survey data scoped to the organization.

### 23. Travel Support

Visa and travel documentation:

- **Travel letters**: Generate official letters for visa applications.
- **Letterhead entities**: Maintain company letterhead information for official correspondence.

---

## Admin Tools

### Roles & Access Configuration

- **Default role permissions**: Configure what each role can see and do by default.
- **Per-user overrides**: Grant or revoke specific navigation items and dashboard widgets for individual users.
- **Navigation access**: Control which sidebar items appear for each role.

### Audit Log

- **Complete audit trail**: Every action logged with actor, timestamp, action type, affected table, and old/new values.
- **Queryable**: Filter audit entries by actor, action, date range, and entity.

---

## Authentication & Security

- **Email + TOTP login**: Two-step authentication using email and a 6-digit code from an authenticator app.
- **MFA enforcement**: TOTP-based multi-factor authentication.
- **Rate limiting**: Failed login attempt tracking to prevent brute force attacks.
- **Link preview bot protection**: Prevents bots from consuming invite tokens.
- **Session management**: Server-side session validation with Supabase Auth.
- **Row-level security**: Database-level access control ensuring users only see data they are authorized to access.
- **GDPR data export**: Employees can request an export of their personal data.

---

## Automated Jobs

Crew Hub runs daily automated tasks (07:00 UTC):

| Job | Description |
|-----|-------------|
| Birthday leave | Auto-grant leave on employee birthdays; remind for weekend/holiday adjustments |
| Holiday announcements | Publish country-specific public holiday notices |
| Leave start announcements | Notify teams when approved leave begins |
| Compliance reminders | 7-day warnings, day-of alerts, overdue marking |
| Document expiry | Notify employees 30 days before document expiration |
| Review reminders | Alert employees 2 days before self-review deadlines |

---

## Multi-Country Support

Crew Hub is designed for distributed, international teams:

- **Country-specific leave policies**: Entitlements and rules vary by employee country.
- **Localized payroll engines**: Country-specific tax calculations and statutory deductions.
- **Compliance by jurisdiction**: Track regulatory requirements per country.
- **Currency handling**: Multi-currency compensation with formatted display.
- **Timezone awareness**: Employee profiles include timezone for scheduling and notifications.

---

## Technical Foundation

| Layer | Technology |
|-------|-----------|
| Frontend | React 19+, Next.js, TypeScript, Tailwind CSS |
| State management | React Query |
| Database | PostgreSQL via Supabase with row-level security |
| Authentication | Supabase Auth (email + TOTP) |
| File storage | Supabase Storage with signed URLs |
| Payments | Cashramp, Wise, mock provider |
| PDF generation | React PDF |
| Charts | Recharts |
| Validation | Zod |
| Error tracking | Sentry |
| Deployment | Vercel |
| Scheduled jobs | Vercel Cron |

---

## Feature Availability

Modules are managed through a centralized feature state system:

| State | Modules |
|-------|---------|
| **Live** | Dashboard, Time Off, My Pay, Documents, Approvals, People, Onboarding, Expenses, Compliance, Time Attendance, Notifications, Announcements, Compensation |
| **Limited Pilot** | Payroll, Scheduling, Team Hub, Performance, Learning, Analytics, Signatures |
| **Upcoming** | Surveys, Learning Course Detail |

Feature states can be changed centrally without code deployments, allowing gradual rollout of new capabilities.
