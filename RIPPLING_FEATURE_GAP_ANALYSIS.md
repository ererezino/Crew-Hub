# Crew Hub → Rippling Feature Parity: Gap Analysis & Implementation Guide

> **Generated**: March 2026
> **Scope**: Full comparison of Crew Hub's current capabilities against Rippling's HCM product suite, with end-to-end implementation blueprints for every missing feature.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Capability Matrix](#2-current-capability-matrix)
3. [Priority Roadmap](#3-priority-roadmap)
4. [Feature Implementation Guides](#4-feature-implementation-guides)
   - 4.1 [Benefits Administration](#41-benefits-administration)
   - 4.2 [Recruiting & ATS](#42-recruiting--ats)
   - 4.3 [Time & Attendance](#43-time--attendance)
   - 4.4 [Scheduling](#44-scheduling)
   - 4.5 [Learning Management System](#45-learning-management-system)
   - 4.6 [Employee Surveys](#46-employee-surveys)
   - 4.7 [Headcount Planning](#47-headcount-planning)
   - 4.8 [Workflow Studio (Custom Automations)](#48-workflow-studio-custom-automations)
   - 4.9 [Policy Engine](#49-policy-engine)
   - 4.10 [Integration Marketplace](#410-integration-marketplace)
   - 4.11 [Chat / Internal Messaging](#411-chat--internal-messaging)
   - 4.12 [E-Signatures](#412-e-signatures)
   - 4.13 [Compensation Bands & Benchmarking](#413-compensation-bands--benchmarking)
   - 4.14 [Corporate Cards](#414-corporate-cards)
   - 4.15 [Bill Pay](#415-bill-pay)
   - 4.16 [Travel Management](#416-travel-management)
   - 4.17 [Identity & Access Management (IT)](#417-identity--access-management-it)
   - 4.18 [Device Management (IT)](#418-device-management-it)
   - 4.19 [Mobile App](#419-mobile-app)
   - 4.20 [Global Payroll Expansion & EOR](#420-global-payroll-expansion--eor)
   - 4.21 [Inventory Management (IT)](#421-inventory-management-it)
5. [Cross-Cutting Concerns](#5-cross-cutting-concerns)
6. [Recommended Build Order](#6-recommended-build-order)

---

## 1. Executive Summary

### What Crew Hub Already Has (18 production modules)

Crew Hub is a solid HCM platform with **enterprise-grade payroll** (country-specific tax engines, multi-currency, multi-provider payments), full **people management**, **time-off with approvals**, **compensation administration** (salary + allowances + equity), **expenses with receipt management**, **performance reviews** (360-style with templates), **compliance deadline tracking**, **multi-dimensional analytics**, **document management**, **onboarding/offboarding workflows**, **announcements**, **notifications**, **audit logging**, and a **modern animated dashboard**.

### What Rippling Has That Crew Hub Doesn't (21 feature gaps)

| # | Feature | Rippling Tier | Business Impact | Effort |
|---|---------|--------------|-----------------|--------|
| 1 | Benefits Administration | Core HCM | Critical | XL |
| 2 | Recruiting & ATS | Talent | High | XL |
| 3 | Time & Attendance | Workforce | High | L |
| 4 | Scheduling | Workforce | High | L |
| 5 | Learning Management | Talent | Medium | L |
| 6 | Employee Surveys | Talent | Medium | M |
| 7 | Headcount Planning | Talent | Medium | L |
| 8 | Workflow Studio | Platform | Critical | XL |
| 9 | Policy Engine | Platform | High | L |
| 10 | Integration Marketplace | Platform | High | XL |
| 11 | Chat / Messaging | HCM | Medium | L |
| 12 | E-Signatures | Documents | High | M |
| 13 | Compensation Bands | HCM | Medium | M |
| 14 | Corporate Cards | Spend | Medium | XL |
| 15 | Bill Pay | Spend | Low | L |
| 16 | Travel Management | Spend | Low | L |
| 17 | Identity & Access (IT) | IT | Medium | XL |
| 18 | Device Management (IT) | IT | Low | L |
| 19 | Mobile App | Workforce | High | XL |
| 20 | Global Payroll Expansion | Payroll | Critical | XL |
| 21 | Inventory Management (IT) | IT | Low | M |

**Effort Key**: S = 1-2 days, M = 3-5 days, L = 1-3 weeks, XL = 1-3 months

---

## 2. Current Capability Matrix

| Rippling Module | Crew Hub Status | Gap Level |
|-----------------|----------------|-----------|
| **HCM — HR Management** | | |
| HRIS (People, Profiles) | ✅ Full | None |
| HR Services (Help Desk) | ❌ Missing | Medium |
| Compliance 360 | ⚠️ Partial (deadline tracking only) | Small |
| Compensation Bands | ❌ Missing | Medium |
| Documents | ✅ Full | None |
| **HCM — Talent** | | |
| Headcount Planning | ❌ Missing | Large |
| Recruiting / ATS | ❌ Missing | Large |
| Performance Management | ✅ Full | None |
| Surveys | ❌ Missing | Medium |
| Learning Management | ❌ Missing | Large |
| **HCM — Benefits** | | |
| Benefits Administration | ❌ Missing | Large |
| PEO | ❌ Missing (business model) | N/A |
| Flex Benefits | ❌ Missing | Large |
| 401(k) / Retirement | ❌ Missing | Medium |
| **HCM — Workforce Management** | | |
| Time & Attendance | ❌ Missing (have Time Off only) | Large |
| Scheduling | ❌ Missing | Large |
| Time Off | ✅ Full | None |
| Leave Management | ✅ Full | None |
| Mobile App | ❌ Missing | Large |
| **Payroll** | | |
| Domestic Payroll | ✅ Full (Nigeria) | None |
| Global Payroll | ⚠️ Single country | Large |
| Contractors | ✅ Partial | Small |
| Employer of Record | ❌ Missing | Large |
| **Spend** | | |
| Expense Management | ✅ Full | None |
| Corporate Cards | ❌ Missing | Large |
| Bill Pay | ❌ Missing | Medium |
| Travel | ❌ Missing | Medium |
| **Platform** | | |
| Workflow Studio | ❌ Missing | Large |
| Analytics | ✅ Full | None |
| Policies | ❌ Missing | Large |
| Permissions (RBAC) | ✅ Basic (5 roles) | Small |
| Integrations | ❌ Missing | Large |
| App Studio | ❌ Missing | Large |
| **IT** | | |
| Identity & Access | ❌ Missing | Large |
| Device Management | ❌ Missing | Medium |
| Inventory Management | ❌ Missing | Medium |

---

## 3. Priority Roadmap

### Phase 1 — Core HCM Parity (Months 1-3)
These features are expected by any serious HCM buyer:

1. **Benefits Administration** — Table-stakes for US market
2. **Recruiting & ATS** — Closes the hire-to-retire loop
3. **Time & Attendance** — Required for hourly workers
4. **Scheduling** — Pairs with T&A for workforce management
5. **E-Signatures** — Unblocks paperless onboarding

### Phase 2 — Platform & Intelligence (Months 3-5)
These features differentiate you from basic HRIS:

6. **Workflow Studio** — Rippling's killer feature (custom automations)
7. **Policy Engine** — Powers compliance and rules enforcement
8. **Compensation Bands** — Enables pay equity and hiring ranges
9. **Employee Surveys** — Engagement measurement
10. **Headcount Planning** — Strategic HR

### Phase 3 — Ecosystem & Scale (Months 5-8)
These features drive stickiness and expansion:

11. **Integration Marketplace** — Connect to 650+ tools
12. **Learning Management** — Training & development
13. **Chat / Messaging** — Reduce tool sprawl
14. **Mobile App** — Field workers and remote teams
15. **Global Payroll Expansion** — Multi-country

### Phase 4 — Spend & IT (Months 8-12)
Rippling's expansion into adjacent categories:

16. **Corporate Cards** — Requires banking partnerships
17. **Bill Pay** — AP automation
18. **Travel Management** — Booking & policy
19. **Identity & Access Management** — SSO/SCIM
20. **Device Management** — MDM
21. **Inventory Management** — Asset tracking

---

## 4. Feature Implementation Guides

---

### 4.1 Benefits Administration

**What Rippling Does**: Employees enroll in health, dental, vision, life, disability, FSA/HSA, and commuter benefits during open enrollment or qualifying life events. Admins configure plan options, contribution structures, and eligibility rules. The system auto-deducts premiums from payroll.

#### Database Schema

```sql
-- Migration: phase_6.1_benefits.sql

-- Plan types offered by the company
CREATE TABLE benefit_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  -- Plan classification
  type            varchar(40) NOT NULL, -- health, dental, vision, life, disability, fsa, hsa, retirement, commuter, other
  subtype         varchar(60),          -- e.g., "PPO", "HMO", "HDHP", "Term Life"
  name            varchar(200) NOT NULL,
  description     text,

  -- Provider / carrier info
  carrier_name    varchar(200),
  carrier_id      varchar(100),
  group_number    varchar(100),

  -- Eligibility
  eligible_employment_types  text[] DEFAULT '{full_time}',
  eligible_departments       text[],          -- NULL = all departments
  waiting_period_days        int DEFAULT 0,
  min_hours_per_week         numeric(5,2),    -- for ACA compliance

  -- Contribution structure
  employer_contribution_type varchar(20) DEFAULT 'percentage', -- percentage, flat, tiered
  employer_contribution      jsonb NOT NULL DEFAULT '[]',
  -- Example: [{"tier": "employee_only", "amount": 80, "unit": "percentage"},
  --           {"tier": "employee_spouse", "amount": 70, "unit": "percentage"},
  --           {"tier": "family", "amount": 60, "unit": "percentage"}]

  -- Premium schedule (monthly costs by coverage tier)
  premiums        jsonb NOT NULL DEFAULT '{}',
  -- Example: {"employee_only": 45000, "employee_spouse": 90000,
  --           "employee_children": 85000, "family": 130000}  -- in cents

  -- Plan documents
  summary_document_id  uuid REFERENCES documents(id),
  sbc_document_id      uuid REFERENCES documents(id),  -- Summary of Benefits & Coverage

  -- Plan year
  plan_year_start date NOT NULL,
  plan_year_end   date NOT NULL,
  is_active       boolean DEFAULT true,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT valid_plan_year CHECK (plan_year_end > plan_year_start)
);

-- Open enrollment windows
CREATE TABLE enrollment_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  name            varchar(200) NOT NULL,
  type            varchar(30) NOT NULL, -- open_enrollment, new_hire, qualifying_life_event
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  effective_date  date NOT NULL,       -- when coverage begins
  status          varchar(20) DEFAULT 'upcoming', -- upcoming, active, closed

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT valid_window CHECK (end_date >= start_date)
);

-- Employee benefit elections
CREATE TABLE benefit_elections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  employee_id         uuid NOT NULL REFERENCES profiles(id),
  plan_id             uuid NOT NULL REFERENCES benefit_plans(id),
  enrollment_period_id uuid REFERENCES enrollment_periods(id),

  -- Election details
  coverage_tier       varchar(40) NOT NULL, -- employee_only, employee_spouse, employee_children, family
  status              varchar(20) DEFAULT 'pending', -- pending, active, waived, terminated

  -- Dependents covered
  dependents          jsonb DEFAULT '[]',
  -- Example: [{"name": "Jane Doe", "relationship": "spouse", "dob": "1990-05-15", "ssn_last4": "1234"}]

  -- Cost breakdown (monthly, in cents)
  employee_premium    bigint NOT NULL DEFAULT 0,
  employer_premium    bigint NOT NULL DEFAULT 0,
  total_premium       bigint NOT NULL DEFAULT 0,

  -- Dates
  coverage_start_date date NOT NULL,
  coverage_end_date   date,
  elected_at          timestamptz,
  waived_at           timestamptz,

  -- Life event (if not open enrollment)
  qualifying_event_type varchar(60), -- marriage, birth, divorce, loss_of_coverage, etc.
  qualifying_event_date date,
  supporting_document_id uuid REFERENCES documents(id),

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,

  CONSTRAINT valid_coverage CHECK (coverage_end_date IS NULL OR coverage_end_date >= coverage_start_date)
);

-- Benefit deductions (links to payroll)
CREATE TABLE benefit_deductions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  election_id         uuid NOT NULL REFERENCES benefit_elections(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES profiles(id),

  amount_per_period   bigint NOT NULL,  -- in cents
  currency            varchar(3) DEFAULT 'USD',
  frequency           varchar(20) DEFAULT 'monthly', -- per_payroll, monthly
  pre_tax             boolean DEFAULT false,  -- for FSA, HSA, 401k, etc.

  effective_from      date NOT NULL,
  effective_to        date,
  is_active           boolean DEFAULT true,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Dependents (reusable across plans)
CREATE TABLE dependents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  employee_id     uuid NOT NULL REFERENCES profiles(id),

  first_name      varchar(100) NOT NULL,
  last_name       varchar(100) NOT NULL,
  relationship    varchar(30) NOT NULL, -- spouse, domestic_partner, child, stepchild, other
  date_of_birth   date NOT NULL,
  gender          varchar(20),
  ssn_encrypted   text,  -- encrypted SSN for US
  ssn_last4       varchar(4),

  is_disabled     boolean DEFAULT false,
  is_student      boolean DEFAULT false,  -- for child coverage extension

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- Indexes
CREATE INDEX idx_benefit_plans_org ON benefit_plans(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_benefit_elections_employee ON benefit_elections(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_benefit_elections_plan ON benefit_elections(plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_benefit_deductions_employee ON benefit_deductions(employee_id) WHERE is_active = true;
CREATE INDEX idx_dependents_employee ON dependents(employee_id) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE benefit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefit_elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefit_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependents ENABLE ROW LEVEL SECURITY;

-- Policies (employees see own elections, HR sees all)
CREATE POLICY "employees_read_own_elections" ON benefit_elections
  FOR SELECT USING (
    employee_id = auth.uid()
    OR has_role('HR_ADMIN') OR has_role('SUPER_ADMIN')
  );

CREATE POLICY "hr_manage_elections" ON benefit_elections
  FOR ALL USING (has_role('HR_ADMIN') OR has_role('SUPER_ADMIN'));

-- Similar policies for all other tables...
```

#### API Routes

```
GET    /api/v1/benefits/plans              — List available plans (filtered by eligibility)
POST   /api/v1/benefits/plans              — Create plan (HR_ADMIN)
PUT    /api/v1/benefits/plans/[planId]      — Update plan
DELETE /api/v1/benefits/plans/[planId]      — Soft-delete plan

GET    /api/v1/benefits/enrollment          — Get current enrollment period + employee's elections
POST   /api/v1/benefits/enrollment/elect    — Make/update election
POST   /api/v1/benefits/enrollment/waive    — Waive coverage for a plan

GET    /api/v1/benefits/me                  — Employee's current benefits summary
GET    /api/v1/benefits/me/dependents       — Employee's dependents
POST   /api/v1/benefits/me/dependents       — Add dependent
PUT    /api/v1/benefits/me/dependents/[id]  — Update dependent

GET    /api/v1/benefits/admin/elections     — All employee elections (HR_ADMIN)
GET    /api/v1/benefits/admin/costs         — Benefits cost report
POST   /api/v1/benefits/admin/enrollment-periods — Create enrollment window
```

#### UI Pages

```
/benefits                    — Employee benefits hub (current plans, costs, dependents)
/benefits/enroll             — Enrollment wizard (step-by-step plan selection)
/benefits/enroll/[planType]  — Individual plan election page
/admin/benefits              — Admin: plan management, enrollment periods
/admin/benefits/plans/new    — Admin: create new benefit plan
/admin/benefits/reports      — Admin: cost analysis, enrollment statistics
```

#### Key Implementation Details

1. **Payroll Integration**: The `benefit_deductions` table feeds into your existing payroll calculation. In `app/api/v1/payroll/runs/[id]/calculate`, query active benefit deductions for each employee and subtract them (pre-tax deductions reduce gross before tax calculation, post-tax deductions reduce net after tax).

2. **Enrollment Wizard**: Build a multi-step form component (`components/benefits/enrollment-wizard.tsx`) with steps: (1) Review eligible plans → (2) Select coverage tier → (3) Add/confirm dependents → (4) Review costs → (5) Confirm elections.

3. **Qualifying Life Events**: When an employee reports a life event (marriage, new child, etc.), create a special `enrollment_period` with `type: 'qualifying_life_event'` scoped to that employee. They get a 30-day window to modify elections.

4. **ACA Compliance** (US): Track hours worked per employee. If an employee averages 30+ hours/week over a measurement period, they become ACA-eligible. Add a cron job or Supabase Edge Function that runs monthly to flag newly eligible employees.

5. **Carrier Feeds**: For production, you'll need EDI 834 file generation to send enrollment data to insurance carriers. Create a `lib/benefits/edi-834.ts` module that serializes elections into the standard EDI format.

---

### 4.2 Recruiting & ATS

**What Rippling Does**: Post jobs to boards, track candidates through a pipeline, schedule interviews, collect scorecards, extend offers, and auto-flow hired candidates into onboarding.

#### Database Schema

```sql
-- Migration: phase_6.2_recruiting.sql

-- Job requisitions
CREATE TABLE job_requisitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  title           varchar(200) NOT NULL,
  department      varchar(100),
  location        varchar(200),
  country_code    varchar(2),
  employment_type varchar(20) DEFAULT 'full_time',

  -- Compensation range
  salary_min      bigint,
  salary_max      bigint,
  salary_currency varchar(3) DEFAULT 'USD',

  -- Details
  description     text NOT NULL,
  requirements    text,
  nice_to_haves   text,

  -- Hiring team
  hiring_manager_id uuid REFERENCES profiles(id),
  recruiter_id      uuid REFERENCES profiles(id),
  interview_panel   uuid[],  -- array of profile IDs

  -- Pipeline config
  pipeline_stages   jsonb NOT NULL DEFAULT '["applied","phone_screen","interview","final_round","offer","hired"]',

  -- Status
  status          varchar(20) DEFAULT 'draft', -- draft, open, paused, closed, filled
  headcount       int DEFAULT 1,
  filled_count    int DEFAULT 0,

  -- Posting
  is_public       boolean DEFAULT false,
  external_url    text,
  posted_to       text[],  -- ['linkedin', 'indeed', 'website']

  -- Approval
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,

  opened_at       timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- Candidates
CREATE TABLE candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  -- Personal info
  first_name      varchar(100) NOT NULL,
  last_name       varchar(100) NOT NULL,
  email           varchar(255) NOT NULL,
  phone           varchar(30),

  -- Profile
  linkedin_url    text,
  portfolio_url   text,
  resume_file_path text,

  -- Source tracking
  source          varchar(60), -- referral, linkedin, indeed, website, agency, other
  referrer_id     uuid REFERENCES profiles(id),

  -- Tags and notes
  tags            text[],

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT unique_candidate_email UNIQUE (org_id, email)
);

-- Applications (junction: candidate <-> requisition)
CREATE TABLE applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  candidate_id        uuid NOT NULL REFERENCES candidates(id),
  requisition_id      uuid NOT NULL REFERENCES job_requisitions(id),

  -- Pipeline position
  current_stage       varchar(60) DEFAULT 'applied',
  status              varchar(20) DEFAULT 'active', -- active, hired, rejected, withdrawn

  -- Rejection details
  rejection_reason    varchar(200),
  rejection_notes     text,
  rejected_by         uuid REFERENCES profiles(id),
  rejected_at         timestamptz,

  -- Offer details
  offer_salary        bigint,
  offer_currency      varchar(3),
  offer_start_date    date,
  offer_letter_document_id uuid REFERENCES documents(id),
  offer_sent_at       timestamptz,
  offer_accepted_at   timestamptz,
  offer_declined_at   timestamptz,

  -- Conversion
  hired_profile_id    uuid REFERENCES profiles(id), -- links to created employee profile
  hired_at            timestamptz,

  applied_at          timestamptz DEFAULT now(),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,

  CONSTRAINT unique_application UNIQUE (candidate_id, requisition_id)
);

-- Interview schedule
CREATE TABLE interviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  application_id      uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,

  -- Schedule
  interviewer_id      uuid NOT NULL REFERENCES profiles(id),
  stage               varchar(60) NOT NULL,
  scheduled_at        timestamptz NOT NULL,
  duration_minutes    int DEFAULT 60,
  location            text,  -- room name, video link, etc.
  meeting_link        text,

  -- Status
  status              varchar(20) DEFAULT 'scheduled', -- scheduled, completed, cancelled, no_show

  -- Notes
  notes               text,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz
);

-- Interview scorecards
CREATE TABLE scorecards (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  interview_id        uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  interviewer_id      uuid NOT NULL REFERENCES profiles(id),

  -- Overall
  overall_rating      int CHECK (overall_rating BETWEEN 1 AND 5),
  recommendation      varchar(20), -- strong_hire, hire, no_hire, strong_no_hire

  -- Criteria ratings
  criteria_scores     jsonb DEFAULT '[]',
  -- Example: [{"criterion": "Technical Skills", "rating": 4, "notes": "..."},
  --           {"criterion": "Communication", "rating": 5, "notes": "..."}]

  -- Notes
  strengths           text,
  concerns            text,
  overall_notes       text,

  submitted_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  CONSTRAINT unique_scorecard UNIQUE (interview_id, interviewer_id)
);

-- Indexes
CREATE INDEX idx_requisitions_org_status ON job_requisitions(org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_applications_requisition ON applications(requisition_id, current_stage) WHERE deleted_at IS NULL;
CREATE INDEX idx_applications_candidate ON applications(candidate_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_interviews_application ON interviews(application_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_interviews_interviewer ON interviews(interviewer_id, scheduled_at) WHERE deleted_at IS NULL;
```

#### API Routes

```
-- Requisitions
GET    /api/v1/recruiting/requisitions              — List open reqs
POST   /api/v1/recruiting/requisitions              — Create req
PUT    /api/v1/recruiting/requisitions/[id]          — Update req
POST   /api/v1/recruiting/requisitions/[id]/publish  — Publish to job boards

-- Candidates & Applications
GET    /api/v1/recruiting/candidates                 — Search candidates
POST   /api/v1/recruiting/candidates                 — Add candidate
GET    /api/v1/recruiting/applications               — List applications (with pipeline view)
POST   /api/v1/recruiting/applications               — Submit application
PUT    /api/v1/recruiting/applications/[id]/stage     — Move through pipeline
POST   /api/v1/recruiting/applications/[id]/reject    — Reject with reason
POST   /api/v1/recruiting/applications/[id]/offer     — Send offer
POST   /api/v1/recruiting/applications/[id]/hire      — Convert to employee

-- Interviews
POST   /api/v1/recruiting/interviews                 — Schedule interview
PUT    /api/v1/recruiting/interviews/[id]             — Update schedule
POST   /api/v1/recruiting/interviews/[id]/scorecard   — Submit scorecard

-- Public
GET    /api/v1/careers                               — Public careers page (open reqs)
POST   /api/v1/careers/apply                         — Public application submission

-- Analytics
GET    /api/v1/recruiting/analytics                  — Pipeline metrics, time-to-hire, source effectiveness
```

#### UI Pages

```
/recruiting                           — Kanban board view of all pipelines
/recruiting/requisitions              — List/manage job requisitions
/recruiting/requisitions/new          — Create new requisition
/recruiting/requisitions/[id]         — Requisition detail with application pipeline
/recruiting/candidates                — Candidate database/search
/recruiting/candidates/[id]           — Candidate profile (history across reqs)
/recruiting/interviews                — My upcoming interviews
/recruiting/interviews/[id]/scorecard — Fill in scorecard
/recruiting/analytics                 — Recruiting metrics dashboard
/careers                              — Public careers page (no auth required)
/careers/[slug]                       — Public job detail + apply form
```

#### Key Implementation Details

1. **Kanban Pipeline**: Build a drag-and-drop Kanban board using `@dnd-kit/core`. Each column = a pipeline stage. Dragging a card = PUT to `/applications/[id]/stage`. Use `framer-motion` for smooth transitions.

2. **Hire-to-Onboard Flow**: When HR clicks "Hire", the `/applications/[id]/hire` endpoint should: (a) create a new `profiles` record with `status: 'onboarding'`, (b) create an `onboarding_instances` record from the department's onboarding template, (c) send a notification to the new hire, (d) update the application's `hired_profile_id`.

3. **Public Careers Page**: Create a separate layout in `app/(public)/careers/` that doesn't require authentication. Use a new `app/(public)/layout.tsx` with a minimal header showing just your company logo and name.

4. **Email Notifications**: Send transactional emails at key stages: application received, interview scheduled, offer extended, offer accepted. Integrate with your existing notification system + an email provider (Resend, SendGrid, or Postmark).

5. **Resume Parsing**: Optionally integrate an AI resume parser (e.g., Anthropic API or a dedicated service like Affinda) that auto-extracts name, email, experience, and skills from uploaded resumes to pre-fill candidate records.

---

### 4.3 Time & Attendance

**What Rippling Does**: Employees clock in/out via web, mobile, or kiosk. Managers approve timesheets. System enforces overtime rules, break policies, and feeds hours into payroll.

#### Database Schema

```sql
-- Migration: phase_6.3_time_attendance.sql

-- Time tracking policies per org/department
CREATE TABLE time_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  name                varchar(200) NOT NULL,

  -- Scope
  applies_to_departments text[],  -- NULL = all
  applies_to_types       text[],  -- employment types
  country_code           varchar(2),

  -- Work schedule
  weekly_hours_target    numeric(5,2) DEFAULT 40.00,
  daily_hours_max        numeric(4,2) DEFAULT 12.00,

  -- Overtime rules
  overtime_after_daily   numeric(4,2),  -- e.g., 8.00 hours
  overtime_after_weekly  numeric(5,2),  -- e.g., 40.00 hours
  overtime_multiplier    numeric(3,2) DEFAULT 1.50,
  double_time_after      numeric(4,2),  -- e.g., 12.00 hours daily
  double_time_multiplier numeric(3,2) DEFAULT 2.00,

  -- Break rules
  break_after_hours      numeric(4,2) DEFAULT 6.00,
  break_duration_minutes int DEFAULT 30,
  paid_break             boolean DEFAULT false,

  -- Rounding
  rounding_rule          varchar(20) DEFAULT 'nearest_15', -- none, nearest_5, nearest_15, nearest_30

  -- Geofencing (optional)
  require_geolocation    boolean DEFAULT false,
  allowed_locations      jsonb DEFAULT '[]',  -- [{lat, lng, radius_meters, name}]

  is_active              boolean DEFAULT true,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  deleted_at             timestamptz
);

-- Individual time entries (clock in/out)
CREATE TABLE time_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  employee_id         uuid NOT NULL REFERENCES profiles(id),
  policy_id           uuid REFERENCES time_policies(id),

  -- Clock times
  clock_in            timestamptz NOT NULL,
  clock_out           timestamptz,

  -- Calculated
  regular_minutes     int DEFAULT 0,
  overtime_minutes    int DEFAULT 0,
  double_time_minutes int DEFAULT 0,
  break_minutes       int DEFAULT 0,
  total_minutes       int DEFAULT 0,

  -- Break tracking
  breaks              jsonb DEFAULT '[]',
  -- Example: [{"start": "2026-03-01T12:00:00Z", "end": "2026-03-01T12:30:00Z", "duration_minutes": 30}]

  -- Metadata
  clock_in_method     varchar(20) DEFAULT 'web', -- web, mobile, kiosk, manual
  clock_out_method    varchar(20),
  clock_in_location   jsonb,  -- {lat, lng, accuracy}
  clock_out_location  jsonb,

  -- Notes / edits
  notes               text,
  edited_by           uuid REFERENCES profiles(id),
  edit_reason         text,
  original_clock_in   timestamptz,
  original_clock_out  timestamptz,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz
);

-- Weekly timesheets (aggregated for approval)
CREATE TABLE timesheets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  employee_id         uuid NOT NULL REFERENCES profiles(id),

  -- Period
  week_start          date NOT NULL,
  week_end            date NOT NULL,

  -- Totals
  total_regular_minutes    int DEFAULT 0,
  total_overtime_minutes   int DEFAULT 0,
  total_double_time_minutes int DEFAULT 0,
  total_break_minutes      int DEFAULT 0,
  total_worked_minutes     int DEFAULT 0,

  -- Approval
  status              varchar(20) DEFAULT 'pending', -- pending, submitted, approved, rejected, locked
  submitted_at        timestamptz,
  approved_by         uuid REFERENCES profiles(id),
  approved_at         timestamptz,
  rejection_reason    text,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,

  CONSTRAINT unique_timesheet UNIQUE (employee_id, week_start)
);

-- Indexes
CREATE INDEX idx_time_entries_employee_date ON time_entries(employee_id, clock_in) WHERE deleted_at IS NULL;
CREATE INDEX idx_timesheets_employee_week ON timesheets(employee_id, week_start) WHERE deleted_at IS NULL;
CREATE INDEX idx_timesheets_approver ON timesheets(approved_by, status) WHERE deleted_at IS NULL;
```

#### API Routes

```
POST   /api/v1/time/clock-in                — Clock in (captures timestamp + optional location)
POST   /api/v1/time/clock-out               — Clock out
POST   /api/v1/time/break/start             — Start break
POST   /api/v1/time/break/end               — End break
GET    /api/v1/time/entries                  — My time entries (filterable by date range)
POST   /api/v1/time/entries                  — Manual time entry
PUT    /api/v1/time/entries/[id]             — Edit entry (with audit trail)

GET    /api/v1/time/timesheets               — My timesheets
POST   /api/v1/time/timesheets/[id]/submit   — Submit for approval
GET    /api/v1/time/approvals                — Manager: pending timesheets
POST   /api/v1/time/approvals/[id]/approve   — Approve timesheet
POST   /api/v1/time/approvals/[id]/reject    — Reject timesheet

GET    /api/v1/time/policies                 — Admin: list policies
POST   /api/v1/time/policies                 — Admin: create policy
GET    /api/v1/time/reports                  — Admin: attendance reports, overtime summary
```

#### UI Pages

```
/time-tracking                — Employee time clock (big clock-in/out button)
/time-tracking/entries        — My time entry history
/time-tracking/timesheets     — My weekly timesheets
/time-tracking/approvals      — Manager: approve timesheets
/admin/time-policies          — Admin: manage time & overtime policies
/time-tracking/reports        — Admin: attendance reports
```

#### Key Implementation Details

1. **Clock Widget**: Create a persistent clock-in/out widget component that lives in the sidebar or top bar. It should show: current status (clocked in / out), elapsed time today, and a big toggle button. Persist the current clock-in state in the database and show it across page navigations.

2. **Overtime Calculation**: When clocking out, run the overtime calculation engine:
   - Sum daily hours. Hours > `overtime_after_daily` → overtime. Hours > `double_time_after` → double time.
   - Sum weekly hours. Hours > `overtime_after_weekly` → overtime (only if not already counted as daily OT).
   - Store the breakdown in `time_entries`.

3. **Rounding**: Apply rounding rules at clock-in/out time (e.g., `nearest_15` rounds 9:07 to 9:00, rounds 9:08 to 9:15).

4. **Payroll Feed**: In your payroll calculation, add a step that queries approved timesheets for the pay period and multiplies: `regular_hours * hourly_rate + overtime_hours * hourly_rate * overtime_multiplier + ...`. Create a helper `lib/time/payroll-feed.ts`.

5. **Auto-Timesheet**: Create a Supabase Edge Function (cron) that runs every Sunday at midnight, aggregating the week's time entries into a `timesheets` row and notifying the employee to review/submit.

---

### 4.4 Scheduling

**What Rippling Does**: Managers create shift schedules, employees view their upcoming shifts, request swaps, and pick up open shifts. Integrates with Time & Attendance.

#### Database Schema

```sql
-- Migration: phase_6.4_scheduling.sql

-- Shift templates (reusable patterns)
CREATE TABLE shift_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  name            varchar(200) NOT NULL,
  department      varchar(100),
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  break_minutes   int DEFAULT 0,
  color           varchar(7), -- hex color for UI

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- Published schedules
CREATE TABLE schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  name            varchar(200),
  department      varchar(100),
  week_start      date NOT NULL,
  week_end        date NOT NULL,

  status          varchar(20) DEFAULT 'draft', -- draft, published, locked
  published_at    timestamptz,
  published_by    uuid REFERENCES profiles(id),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- Individual shifts
CREATE TABLE shifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  schedule_id     uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  template_id     uuid REFERENCES shift_templates(id),

  employee_id     uuid REFERENCES profiles(id),  -- NULL = open shift

  shift_date      date NOT NULL,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz NOT NULL,
  break_minutes   int DEFAULT 0,

  -- Status
  status          varchar(20) DEFAULT 'scheduled', -- scheduled, swap_requested, swapped, cancelled

  notes           text,
  color           varchar(7),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- Shift swap requests
CREATE TABLE shift_swaps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  shift_id        uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,

  requester_id    uuid NOT NULL REFERENCES profiles(id),
  target_id       uuid REFERENCES profiles(id),  -- NULL = open to anyone

  reason          text,
  status          varchar(20) DEFAULT 'pending', -- pending, accepted, rejected, cancelled

  approved_by     uuid REFERENCES profiles(id),  -- manager approval
  approved_at     timestamptz,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_shifts_schedule ON shifts(schedule_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_shifts_employee_date ON shifts(employee_id, shift_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_shifts_open ON shifts(org_id, shift_date) WHERE employee_id IS NULL AND deleted_at IS NULL;
```

#### API Routes

```
GET    /api/v1/scheduling/schedules              — List schedules
POST   /api/v1/scheduling/schedules              — Create schedule
POST   /api/v1/scheduling/schedules/[id]/publish — Publish schedule
GET    /api/v1/scheduling/shifts                 — My upcoming shifts / team shifts
POST   /api/v1/scheduling/shifts                 — Add shift to schedule
PUT    /api/v1/scheduling/shifts/[id]            — Update shift
GET    /api/v1/scheduling/shifts/open            — Open shifts available
POST   /api/v1/scheduling/shifts/[id]/claim      — Claim open shift
POST   /api/v1/scheduling/swaps                  — Request shift swap
PUT    /api/v1/scheduling/swaps/[id]             — Accept/reject swap (+ manager approve)
GET    /api/v1/scheduling/templates              — Shift templates
POST   /api/v1/scheduling/templates              — Create template
```

#### UI Pages

```
/scheduling                  — Weekly calendar view (my shifts)
/scheduling/manage           — Manager: drag-and-drop schedule builder
/scheduling/open-shifts      — Available open shifts
/scheduling/swaps            — Swap requests (sent/received)
/admin/scheduling/templates  — Manage shift templates
```

#### Key Implementation Details

1. **Calendar UI**: Use a weekly calendar grid component. Rows = employees, columns = days. Each cell can have multiple shift blocks. Use `@dnd-kit` for drag-and-drop shift assignment. Color-code by shift template.

2. **Conflict Detection**: Before saving a shift, check for: (a) overlapping shifts for the same employee, (b) minimum rest period between shifts (e.g., 8 hours), (c) maximum weekly hours from the time policy, (d) leave requests on the same day.

3. **Open Shift Marketplace**: When a shift has `employee_id = NULL`, it appears in the open shifts feed. Any eligible employee can "claim" it. Manager gets a notification to approve.

4. **Notifications**: Notify employees when (a) a new schedule is published, (b) their shift changes, (c) someone wants to swap with them, (d) an open shift matches their department.

---

### 4.5 Learning Management System

**What Rippling Does**: Assign training courses (compliance, skills, onboarding), track completion, support SCORM content, auto-assign based on role/department/location, and report on completion rates.

#### Database Schema

```sql
-- Migration: phase_6.5_lms.sql

CREATE TABLE courses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  title           varchar(200) NOT NULL,
  description     text,
  category        varchar(60), -- compliance, technical, soft_skills, onboarding, security, custom

  -- Content
  content_type    varchar(30) NOT NULL, -- video, document, scorm, link, quiz, multi_module
  content_url     text,
  content_file_path text,
  thumbnail_url   text,

  -- Modules (for multi_module courses)
  modules         jsonb DEFAULT '[]',
  -- Example: [{"id": "m1", "title": "Intro", "type": "video", "url": "...", "duration_minutes": 15},
  --           {"id": "m2", "title": "Quiz", "type": "quiz", "questions": [...]}]

  -- Metadata
  duration_minutes int,
  difficulty       varchar(20), -- beginner, intermediate, advanced
  passing_score    int,          -- for quizzes, percentage 0-100

  -- Auto-assignment rules
  auto_assign_rules jsonb DEFAULT '[]',
  -- Example: [{"type": "department", "value": "Engineering"},
  --           {"type": "role", "value": "EMPLOYEE"},
  --           {"type": "country", "value": "US"}]

  -- Settings
  is_mandatory     boolean DEFAULT false,
  allow_retake     boolean DEFAULT true,
  certificate_template text,  -- HTML template for completion certificate

  -- Recurrence (for compliance training)
  recurrence       varchar(20), -- null, annual, semi_annual, quarterly

  created_by       uuid REFERENCES profiles(id),
  is_published     boolean DEFAULT false,

  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  deleted_at       timestamptz
);

CREATE TABLE course_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  course_id       uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES profiles(id),

  -- Progress
  status          varchar(20) DEFAULT 'assigned', -- assigned, in_progress, completed, overdue, failed
  progress_pct    int DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),

  -- Module progress (for multi-module courses)
  module_progress jsonb DEFAULT '{}',
  -- Example: {"m1": {"completed": true, "completed_at": "..."}, "m2": {"completed": false}}

  -- Quiz scores
  quiz_score      int,  -- percentage
  quiz_attempts   int DEFAULT 0,

  -- Dates
  due_date        date,
  started_at      timestamptz,
  completed_at    timestamptz,

  -- Certificate
  certificate_url text,

  assigned_by     uuid REFERENCES profiles(id),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT unique_assignment UNIQUE (course_id, employee_id)
);

-- Indexes
CREATE INDEX idx_courses_org ON courses(org_id) WHERE deleted_at IS NULL AND is_published = true;
CREATE INDEX idx_assignments_employee ON course_assignments(employee_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_assignments_course ON course_assignments(course_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assignments_overdue ON course_assignments(due_date, status) WHERE status != 'completed' AND deleted_at IS NULL;
```

#### API Routes

```
GET    /api/v1/learning/courses               — Browse available courses
POST   /api/v1/learning/courses               — Create course (admin)
PUT    /api/v1/learning/courses/[id]           — Update course
GET    /api/v1/learning/my-assignments          — My assigned courses
PUT    /api/v1/learning/assignments/[id]/progress — Update progress
POST   /api/v1/learning/assignments/[id]/complete — Mark complete / submit quiz
POST   /api/v1/learning/courses/[id]/assign     — Assign to employees (admin)
GET    /api/v1/learning/admin/reports           — Completion rates, overdue assignments
GET    /api/v1/learning/certificates/[id]       — Download certificate PDF
```

#### UI Pages

```
/learning                     — My learning dashboard (assigned + catalog)
/learning/courses/[id]        — Course player (video, document, quiz)
/learning/certificates        — My earned certificates
/admin/learning               — Course management
/admin/learning/courses/new   — Create course
/admin/learning/reports       — Completion analytics
```

#### Key Implementation Details

1. **Auto-Assignment Engine**: Create a Supabase Edge Function that runs nightly. For each course with `auto_assign_rules`, find employees matching the rules who don't already have an assignment, and create `course_assignments`. Also runs when a new employee is created (hook into onboarding).

2. **Quiz Engine**: Build a `components/learning/quiz-player.tsx` that renders questions from the course's modules JSON. Question types: multiple-choice, true/false, multi-select. Calculate score on submission, compare to `passing_score`.

3. **SCORM Support**: For SCORM packages, upload the ZIP, extract to Supabase Storage, and serve the `index.html` in an iframe. Use the SCORM Runtime API (`window.API` or `window.API_1484_11`) to track completion and score.

4. **Compliance Recurrence**: When a course has `recurrence: 'annual'`, after an employee completes it, schedule a new assignment for 1 year later. A cron job checks for upcoming recurrence dates and creates new assignments.

5. **Certificate Generation**: Use your existing `@react-pdf/renderer` setup to generate completion certificates. Create a `lib/learning/certificate-pdf.tsx` template with employee name, course title, completion date, and a unique certificate ID.

---

### 4.6 Employee Surveys

**What Rippling Does**: Create pulse surveys and engagement surveys, distribute to employees, collect anonymous responses, and view real-time results with benchmarks.

#### Database Schema

```sql
-- Migration: phase_6.6_surveys.sql

CREATE TABLE surveys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  title           varchar(200) NOT NULL,
  description     text,
  type            varchar(30) DEFAULT 'engagement', -- engagement, pulse, onboarding, exit, custom

  -- Questions
  questions       jsonb NOT NULL DEFAULT '[]',
  -- Example: [
  --   {"id": "q1", "text": "How satisfied are you?", "type": "rating", "scale": 10, "required": true},
  --   {"id": "q2", "text": "What could improve?", "type": "text", "required": false},
  --   {"id": "q3", "text": "Department?", "type": "select", "options": ["Eng","Sales","HR"], "required": true},
  --   {"id": "q4", "text": "I feel valued", "type": "likert", "required": true}
  -- ]

  -- Anonymity
  is_anonymous    boolean DEFAULT true,
  min_responses_for_results int DEFAULT 5,  -- hide results until N responses (preserve anonymity)

  -- Distribution
  target_audience jsonb DEFAULT '{}',
  -- Example: {"departments": ["Engineering"], "employment_types": ["full_time"], "countries": ["US"]}
  -- Empty = all employees

  -- Schedule
  status          varchar(20) DEFAULT 'draft', -- draft, active, closed, archived
  start_date      date,
  end_date        date,

  -- Recurrence
  recurrence      varchar(20), -- null, weekly, monthly, quarterly

  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE survey_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  survey_id       uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,

  respondent_id   uuid REFERENCES profiles(id),  -- NULL if anonymous and anonymity enforced

  -- Answers
  answers         jsonb NOT NULL DEFAULT '{}',
  -- Example: {"q1": 8, "q2": "More team events", "q3": "Engineering", "q4": "agree"}

  -- Metadata (anonymized)
  department      varchar(100),  -- captured at time of response for grouping
  country_code    varchar(2),

  submitted_at    timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_surveys_org ON surveys(org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_survey_responses_survey ON survey_responses(survey_id);
```

#### API Routes

```
GET    /api/v1/surveys                          — My pending surveys
POST   /api/v1/surveys                          — Create survey (admin)
PUT    /api/v1/surveys/[id]                     — Update survey
POST   /api/v1/surveys/[id]/launch              — Activate survey
POST   /api/v1/surveys/[id]/respond             — Submit response
GET    /api/v1/surveys/[id]/results             — View results (admin, respects min_responses)
GET    /api/v1/surveys/[id]/results/export      — Export CSV
```

#### UI Pages

```
/surveys              — My pending surveys list
/surveys/[id]         — Take survey
/admin/surveys        — Survey management
/admin/surveys/new    — Create survey (question builder)
/admin/surveys/[id]/results — Results dashboard with charts
```

---

### 4.7 Headcount Planning

**What Rippling Does**: Plan future hires by department, track against budget, model compensation costs, and sync approved headcount to recruiting.

#### Database Schema

```sql
-- Migration: phase_6.7_headcount_planning.sql

CREATE TABLE headcount_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  name            varchar(200) NOT NULL,
  fiscal_year     int NOT NULL,
  status          varchar(20) DEFAULT 'draft', -- draft, active, approved, closed

  -- Budget
  total_budget    bigint,  -- in cents
  currency        varchar(3) DEFAULT 'USD',

  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,

  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE headcount_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  plan_id         uuid NOT NULL REFERENCES headcount_plans(id) ON DELETE CASCADE,

  department      varchar(100) NOT NULL,
  title           varchar(200) NOT NULL,
  justification   text,

  -- Compensation modeling
  estimated_salary_min  bigint,
  estimated_salary_max  bigint,
  currency              varchar(3) DEFAULT 'USD',
  employment_type       varchar(20) DEFAULT 'full_time',

  -- Timeline
  target_start_quarter  varchar(6),  -- e.g., "2026Q2"
  target_start_date     date,

  -- Status
  status          varchar(20) DEFAULT 'requested', -- requested, approved, rejected, filled, cancelled
  priority        varchar(10) DEFAULT 'medium',    -- low, medium, high, critical

  -- Linkage
  requisition_id  uuid REFERENCES job_requisitions(id),  -- links to recruiting when opened
  hired_profile_id uuid REFERENCES profiles(id),          -- links to hire when filled

  requested_by    uuid REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_hc_requests_plan ON headcount_requests(plan_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_hc_requests_dept ON headcount_requests(org_id, department) WHERE deleted_at IS NULL;
```

#### API Routes

```
GET    /api/v1/headcount/plans                    — List plans
POST   /api/v1/headcount/plans                    — Create plan
GET    /api/v1/headcount/plans/[id]               — Plan detail with requests
POST   /api/v1/headcount/plans/[id]/requests      — Add headcount request
PUT    /api/v1/headcount/requests/[id]            — Update request
POST   /api/v1/headcount/requests/[id]/approve    — Approve headcount
POST   /api/v1/headcount/requests/[id]/open-req   — Convert to job requisition
GET    /api/v1/headcount/analytics                — Budget vs actuals, fill rates
```

#### UI Pages

```
/headcount                    — Plan overview with budget tracker
/headcount/plans/[id]         — Plan detail: department breakdown grid
/headcount/requests/new       — Request new headcount
/headcount/analytics          — Budget modeling, fill rate charts
```

---

### 4.8 Workflow Studio (Custom Automations)

**What Rippling Does**: Visual workflow builder where admins create trigger → condition → action automations. Example: "When an employee is hired in California AND their role is Engineer → assign CA harassment training, enroll in dental plan, order laptop."

This is Rippling's most differentiated feature.

#### Database Schema

```sql
-- Migration: phase_7.1_workflows.sql

CREATE TABLE workflows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  name            varchar(200) NOT NULL,
  description     text,

  -- Trigger
  trigger_type    varchar(60) NOT NULL,
  -- Trigger types: employee_created, employee_updated, employee_terminated,
  --               leave_submitted, leave_approved, expense_submitted, expense_approved,
  --               payroll_completed, review_completed, document_uploaded,
  --               compliance_deadline_approaching, scheduled (cron), manual
  trigger_config  jsonb NOT NULL DEFAULT '{}',
  -- For employee_updated: {"fields": ["department", "title", "status"]}
  -- For scheduled: {"cron": "0 9 * * MON", "timezone": "America/New_York"}
  -- For compliance_deadline_approaching: {"days_before": 7}

  -- Conditions (evaluated as AND)
  conditions      jsonb DEFAULT '[]',
  -- Example: [
  --   {"field": "department", "operator": "equals", "value": "Engineering"},
  --   {"field": "country_code", "operator": "in", "value": ["US", "CA"]},
  --   {"field": "employment_type", "operator": "not_equals", "value": "contractor"}
  -- ]

  -- Actions (executed in sequence)
  actions         jsonb NOT NULL DEFAULT '[]',
  -- Example: [
  --   {"type": "assign_course", "config": {"course_id": "uuid"}},
  --   {"type": "send_notification", "config": {"template": "welcome_engineer", "to": "employee"}},
  --   {"type": "create_task", "config": {"title": "Set up dev environment", "assign_to": "manager"}},
  --   {"type": "update_field", "config": {"table": "profiles", "field": "status", "value": "active"}},
  --   {"type": "send_email", "config": {"template_id": "uuid", "to": "employee"}},
  --   {"type": "add_to_group", "config": {"group": "engineering-all"}},
  --   {"type": "wait", "config": {"days": 3}},
  --   {"type": "webhook", "config": {"url": "https://...", "method": "POST"}}
  -- ]

  -- Status
  is_active       boolean DEFAULT false,

  -- Stats
  total_runs      int DEFAULT 0,
  last_run_at     timestamptz,

  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- Execution log
CREATE TABLE workflow_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  workflow_id     uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,

  -- Context
  trigger_data    jsonb NOT NULL,  -- the event that triggered this run
  subject_id      uuid,            -- employee or entity this ran against

  -- Execution
  status          varchar(20) DEFAULT 'running', -- running, completed, failed, skipped
  actions_log     jsonb DEFAULT '[]',
  -- Example: [
  --   {"action": "assign_course", "status": "success", "at": "2026-03-01T10:00:00Z"},
  --   {"action": "send_email", "status": "failed", "error": "Invalid template", "at": "2026-03-01T10:00:01Z"}
  -- ]

  error_message   text,

  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX idx_workflows_org ON workflows(org_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
CREATE INDEX idx_workflow_runs_subject ON workflow_runs(subject_id);
```

#### API Routes

```
GET    /api/v1/workflows                     — List workflows
POST   /api/v1/workflows                     — Create workflow
PUT    /api/v1/workflows/[id]                — Update workflow
POST   /api/v1/workflows/[id]/activate       — Toggle active
POST   /api/v1/workflows/[id]/test           — Dry-run with sample data
GET    /api/v1/workflows/[id]/runs           — Execution history
POST   /api/v1/workflows/trigger             — Internal: fire trigger event
GET    /api/v1/workflows/templates           — Pre-built workflow templates
```

#### UI Pages

```
/workflows                    — Workflow list with active/inactive toggle
/workflows/new                — Visual workflow builder
/workflows/[id]               — Workflow detail + execution log
/workflows/[id]/edit          — Edit workflow
/workflows/templates          — Pre-built templates gallery
```

#### Key Implementation Details

1. **Visual Builder**: Build a node-based workflow editor using `reactflow` (React Flow). Three lane types: Trigger → Conditions → Actions. Users drag action blocks from a sidebar palette onto the canvas. Each block has a configuration panel.

2. **Event Bus**: Create a central `lib/workflows/event-bus.ts` module. All modules emit events through this bus:
   ```typescript
   // lib/workflows/event-bus.ts
   export async function emitWorkflowEvent(
     orgId: string,
     triggerType: string,
     data: Record<string, unknown>
   ) {
     // 1. Find all active workflows matching this trigger
     // 2. Evaluate conditions against the data
     // 3. For matching workflows, create a workflow_run and execute actions
   }
   ```
   Then in your existing API routes, add calls like:
   ```typescript
   // In POST /api/v1/time-off/requests after creating the request:
   await emitWorkflowEvent(orgId, 'leave_submitted', { employeeId, leaveType, ... });
   ```

3. **Action Executors**: Create a registry of action handlers in `lib/workflows/actions/`:
   ```
   lib/workflows/actions/
   ├── assign-course.ts
   ├── send-notification.ts
   ├── send-email.ts
   ├── create-task.ts
   ├── update-field.ts
   ├── webhook.ts
   └── wait.ts        (uses pg_cron or delayed queue)
   ```

4. **Wait Actions**: For `wait` actions (e.g., "wait 3 days then send reminder"), you need a job queue. Options: (a) Supabase Edge Functions with `pg_cron`, (b) a simple `workflow_deferred_actions` table polled by a cron job, or (c) an external queue like Inngest or Trigger.dev.

5. **Pre-built Templates**: Ship 10-15 templates that cover common use cases:
   - New hire onboarding (trigger: employee_created → assign training + create tasks)
   - Offboarding checklist (trigger: status changed to offboarding → revoke access + collect equipment)
   - Birthday greeting (trigger: scheduled cron → check birthdays → send email)
   - Compliance training renewal (trigger: scheduled → check expired certifications → assign courses)
   - Manager change notification (trigger: manager_id updated → notify both managers)

---

### 4.9 Policy Engine

**What Rippling Does**: Define business rules that automatically enforce across the platform. Examples: "All California employees get 5 sick days", "Contractors cannot access benefits", "Engineers get $2,000 learning stipend."

#### Database Schema

```sql
-- Migration: phase_7.2_policies.sql

CREATE TABLE policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  name            varchar(200) NOT NULL,
  description     text,
  category        varchar(60), -- leave, benefits, expense, compliance, security, custom

  -- Target scope
  scope_rules     jsonb NOT NULL DEFAULT '[]',
  -- Example: [
  --   {"field": "country_code", "operator": "equals", "value": "US"},
  --   {"field": "department", "operator": "in", "value": ["Engineering", "Product"]}
  -- ]

  -- Policy rules
  rules           jsonb NOT NULL DEFAULT '[]',
  -- Example: [
  --   {"type": "set_leave_balance", "config": {"leave_type": "sick", "days": 5}},
  --   {"type": "set_expense_limit", "config": {"category": "software", "monthly_limit": 20000}},
  --   {"type": "require_approval", "config": {"action": "expense", "threshold": 50000, "approver": "manager"}},
  --   {"type": "restrict_access", "config": {"module": "benefits", "employment_types": ["contractor"]}}
  -- ]

  -- Priority (higher = evaluated first, first match wins)
  priority        int DEFAULT 0,

  is_active       boolean DEFAULT true,
  effective_from  date,
  effective_to    date,

  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_policies_org ON policies(org_id, is_active, priority DESC) WHERE deleted_at IS NULL;
```

#### Key Implementation Details

1. **Policy Evaluation Engine**: Create `lib/policies/engine.ts` that accepts an employee profile and returns all applicable policies:
   ```typescript
   export async function evaluatePolicies(
     orgId: string,
     employeeProfile: Profile,
     category?: string
   ): Promise<Policy[]> {
     const policies = await getActivePolicies(orgId, category);
     return policies.filter(p => matchesScope(p.scope_rules, employeeProfile));
   }
   ```

2. **Integration Points**: Call the policy engine from existing modules:
   - **Leave**: When creating leave balance, check for policies that set custom leave days
   - **Expenses**: Before approving, check expense limit policies
   - **Benefits**: Filter eligible plans based on policy restrictions
   - **Onboarding**: Apply policies when setting up new employee defaults

---

### 4.10 Integration Marketplace

**What Rippling Does**: 650+ pre-built integrations with popular SaaS tools (Slack, Google Workspace, GitHub, Jira, etc.). Auto-provision/deprovision accounts, sync employee data.

#### Database Schema

```sql
-- Migration: phase_7.3_integrations.sql

-- Available integrations catalog
CREATE TABLE integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  slug            varchar(100) UNIQUE NOT NULL,
  name            varchar(200) NOT NULL,
  description     text,
  category        varchar(60), -- communication, project_management, accounting, identity, storage, crm
  logo_url        text,

  -- Auth method
  auth_type       varchar(20) NOT NULL, -- oauth2, api_key, webhook
  oauth_config    jsonb,  -- {authorize_url, token_url, scopes}

  -- Capabilities
  supports_provisioning  boolean DEFAULT false,  -- auto-create/delete accounts
  supports_sync          boolean DEFAULT false,  -- sync employee data
  supports_sso           boolean DEFAULT false,   -- SSO via this integration

  -- Event mappings
  event_mappings  jsonb DEFAULT '[]',
  -- Example: [
  --   {"trigger": "employee_created", "action": "create_account"},
  --   {"trigger": "employee_terminated", "action": "disable_account"},
  --   {"trigger": "department_changed", "action": "update_groups"}
  -- ]

  is_published    boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

-- Organization's connected integrations
CREATE TABLE integration_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  integration_id  uuid NOT NULL REFERENCES integrations(id),

  -- Auth credentials (encrypted)
  credentials     jsonb NOT NULL,  -- encrypted {access_token, refresh_token, api_key, etc.}

  -- Configuration
  config          jsonb DEFAULT '{}',
  -- Example: {"sync_departments": true, "default_group": "all-employees", "admin_email": "admin@co.com"}

  status          varchar(20) DEFAULT 'active', -- active, paused, error, disconnected
  last_sync_at    timestamptz,
  last_error      text,

  connected_by    uuid REFERENCES profiles(id),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT unique_connection UNIQUE (org_id, integration_id)
);

-- Sync log
CREATE TABLE integration_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL,

  action          varchar(60) NOT NULL,  -- sync_employees, provision_account, deprovision_account
  status          varchar(20) DEFAULT 'success', -- success, failed, skipped
  details         jsonb,
  error           text,

  created_at      timestamptz DEFAULT now()
);
```

#### Key Implementation Details

1. **Start Small**: Begin with 5-10 high-value integrations: Slack, Google Workspace, Microsoft 365, QuickBooks, Xero, GitHub, Jira, BambooHR import, ADP import, Gusto import.

2. **OAuth Flow**: For each OAuth integration, implement the standard flow: (a) redirect user to provider's auth URL, (b) handle callback at `/api/v1/integrations/[slug]/callback`, (c) exchange code for tokens, (d) store encrypted credentials.

3. **Webhook Receivers**: Create `/api/v1/integrations/webhooks/[slug]` endpoints that receive events from connected apps and trigger your workflow engine.

4. **Provisioning Engine**: When the workflow engine fires `employee_created`, loop through active connections that support provisioning and call each provider's "create user" API.

---

### 4.11 Chat / Internal Messaging

**What Rippling Does**: Built-in team messaging with channels, DMs, and file sharing — reducing the need for Slack.

#### Database Schema

```sql
-- Migration: phase_7.4_chat.sql

CREATE TABLE chat_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  name            varchar(100),
  type            varchar(20) NOT NULL, -- direct, group, department, announcement
  description     text,

  -- Members (for group/direct channels)
  member_ids      uuid[] NOT NULL DEFAULT '{}',

  is_archived     boolean DEFAULT false,
  created_by      uuid REFERENCES profiles(id),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  channel_id      uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES profiles(id),

  content         text NOT NULL,

  -- Attachments
  attachments     jsonb DEFAULT '[]',
  -- Example: [{"name": "file.pdf", "url": "...", "size": 1024, "mime": "application/pdf"}]

  -- Threading
  parent_id       uuid REFERENCES chat_messages(id),

  -- Reactions
  reactions       jsonb DEFAULT '{}',
  -- Example: {"👍": ["user1", "user2"], "🎉": ["user3"]}

  -- Edit history
  edited_at       timestamptz,
  is_deleted      boolean DEFAULT false,

  created_at      timestamptz DEFAULT now()
);

-- Read receipts
CREATE TABLE chat_read_receipts (
  channel_id      uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id),
  last_read_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_messages_channel ON chat_messages(channel_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_messages_parent ON chat_messages(parent_id) WHERE parent_id IS NOT NULL AND is_deleted = false;
```

#### Key Implementation Details

1. **Real-time**: Use Supabase Realtime subscriptions. Subscribe to `chat_messages` inserts filtered by `channel_id`. This gives you instant message delivery without a separate WebSocket server.

2. **Unread Counts**: Compare `chat_read_receipts.last_read_at` with the latest message timestamp in each channel. Show unread badges in the sidebar.

3. **UI**: Build a Slack-like split-pane layout: channel list on left, message thread on right. Use `components/chat/` with: `channel-list.tsx`, `message-list.tsx`, `message-input.tsx`, `message-bubble.tsx`.

---

### 4.12 E-Signatures

**What Rippling Does**: Send documents for electronic signature (offer letters, NDAs, policy acknowledgments). Track signature status and store signed copies.

#### Database Schema

```sql
-- Migration: phase_7.5_esignatures.sql

CREATE TABLE signature_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  document_id     uuid NOT NULL REFERENCES documents(id),
  title           varchar(200) NOT NULL,
  message         text,

  -- Signers
  signers         jsonb NOT NULL DEFAULT '[]',
  -- Example: [
  --   {"employee_id": "uuid", "email": "...", "name": "...", "order": 1, "status": "pending"},
  --   {"employee_id": "uuid", "email": "...", "name": "...", "order": 2, "status": "pending"}
  -- ]

  -- Status
  status          varchar(20) DEFAULT 'pending', -- pending, partially_signed, completed, cancelled, expired

  -- Signed document
  signed_document_path text,

  -- Expiry
  expires_at      timestamptz,

  sent_by         uuid REFERENCES profiles(id),
  sent_at         timestamptz,
  completed_at    timestamptz,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE signatures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  request_id          uuid NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,

  signer_employee_id  uuid NOT NULL REFERENCES profiles(id),

  -- Signature data
  signature_image     text,  -- base64 encoded SVG or PNG
  ip_address          inet,
  user_agent          text,

  signed_at           timestamptz NOT NULL DEFAULT now(),

  -- Audit
  consent_text        text DEFAULT 'I agree to sign this document electronically.',

  CONSTRAINT unique_signature UNIQUE (request_id, signer_employee_id)
);
```

#### Key Implementation Details

1. **Signature Pad**: Use `react-signature-canvas` for a draw-to-sign pad. Also support type-to-sign (render name in a script font using Canvas API).

2. **Document Overlay**: Use `pdf-lib` to embed the signature image onto the original PDF at specified coordinates. Store the signed PDF as a new document version.

3. **Audit Trail**: For legal compliance, capture: signer's IP address, user agent, timestamp, consent text, and a hash of the original document. Store in `signatures` table.

4. **Integration with Onboarding**: In the onboarding task system, add a task type `sign_document` that creates a signature request. Mark the onboarding task as completed when the signature is captured.

5. **Alternative**: For production, consider integrating a dedicated e-signature provider (DocuSign, HelloSign/Dropbox Sign, or PandaDoc) via their API rather than building your own. Your `signature_requests` table becomes a wrapper around their API.

---

### 4.13 Compensation Bands & Benchmarking

**What Rippling Does**: Define salary ranges per role/level/location. Flag employees outside their band. Compare against market benchmarks.

#### Database Schema

```sql
-- Migration: phase_7.6_comp_bands.sql

CREATE TABLE compensation_bands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  title           varchar(200) NOT NULL,  -- e.g., "Software Engineer"
  level           varchar(60),             -- e.g., "IC3", "Senior", "L5"
  department      varchar(100),

  -- Geographic adjustment
  location_type   varchar(20) DEFAULT 'global', -- global, country, city, zone
  location_value  varchar(100),  -- e.g., "US", "San Francisco", "Tier 1"

  -- Band ranges (annual, in cents)
  currency        varchar(3) DEFAULT 'USD',
  min_salary      bigint NOT NULL,
  mid_salary      bigint NOT NULL,  -- target / market median
  max_salary      bigint NOT NULL,

  -- Equity range (shares)
  equity_min      int,
  equity_max      int,

  -- Metadata
  effective_from  date NOT NULL,
  effective_to    date,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT valid_band CHECK (min_salary <= mid_salary AND mid_salary <= max_salary)
);

-- Market benchmark data (imported from surveys)
CREATE TABLE benchmark_data (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  source          varchar(100), -- "Radford 2026", "Levels.fyi", "Custom"
  title           varchar(200) NOT NULL,
  level           varchar(60),
  location        varchar(100),
  currency        varchar(3) DEFAULT 'USD',

  p25             bigint,  -- 25th percentile
  p50             bigint,  -- median
  p75             bigint,  -- 75th percentile
  p90             bigint,

  imported_at     timestamptz DEFAULT now()
);

CREATE INDEX idx_comp_bands_org ON compensation_bands(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comp_bands_role ON compensation_bands(org_id, title, level) WHERE deleted_at IS NULL;
```

#### Key Implementation Details

1. **Band Visualization**: Build a `components/compensation/band-chart.tsx` that renders a horizontal bar for each band (min—mid—max) with dots showing where each employee falls. Use Recharts or D3 for the visualization.

2. **Out-of-Band Alerts**: Create a query that joins `compensation_records` with `compensation_bands` (matching on title/level/location) and flags employees whose salary is below min or above max. Show these on the admin dashboard.

3. **Compa-Ratio**: Calculate `compa_ratio = employee_salary / band_midpoint`. Display as a percentage. < 80% = underpaid risk, > 120% = overpaid risk.

---

### 4.14 Corporate Cards

**What Rippling Does**: Issue virtual and physical corporate credit cards with per-employee spend limits, category restrictions, and auto-receipt matching.

#### Key Implementation Notes

This feature requires a **banking partner** (e.g., Stripe Issuing, Marqeta, Lithic). It's not a pure software build.

**Approach**:
1. Integrate with Stripe Issuing API to provision virtual/physical cards
2. Create a `corporate_cards` table tracking card assignments, limits, and status
3. Create a `card_transactions` table fed by Stripe webhooks
4. Build a spend dashboard showing per-employee spend, category breakdown, and limit utilization
5. Auto-match transactions to expense categories and link to your existing expense module
6. Allow managers to set per-card spending limits and merchant category restrictions

**Estimated Effort**: 2-3 months (including banking partner onboarding and compliance requirements like KYC/KYB).

---

### 4.15 Bill Pay

**What Rippling Does**: AP automation — upload vendor invoices, route for approval, schedule payments.

#### Database Schema

```sql
-- Migration: phase_8.1_bill_pay.sql

CREATE TABLE vendors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  name            varchar(200) NOT NULL,
  email           varchar(255),

  -- Payment info
  payment_method  varchar(20), -- bank_transfer, check, wire
  bank_details    jsonb,       -- encrypted

  -- Tax info
  tax_id          varchar(50),
  w9_document_id  uuid REFERENCES documents(id),

  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  vendor_id       uuid NOT NULL REFERENCES vendors(id),

  invoice_number  varchar(100),
  invoice_date    date NOT NULL,
  due_date        date NOT NULL,

  amount          bigint NOT NULL,
  currency        varchar(3) DEFAULT 'USD',

  -- Line items
  line_items      jsonb DEFAULT '[]',

  -- Categorization
  category        varchar(60),
  gl_code         varchar(30),
  department      varchar(100),

  -- Documents
  invoice_document_id uuid REFERENCES documents(id),

  -- Approval
  status          varchar(20) DEFAULT 'pending', -- pending, approved, scheduled, paid, rejected, void
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,

  -- Payment
  payment_date    date,
  payment_reference varchar(100),

  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);
```

---

### 4.16 Travel Management

**What Rippling Does**: Employees book travel (flights, hotels, car rentals) within policy, managers approve, expenses auto-categorize.

#### Key Implementation Notes

**Approach**:
1. Integrate with a travel aggregator API (Duffel for flights, Booking.com for hotels, or Navan/TripActions white-label)
2. Create `travel_requests` table with itinerary, estimated cost, and approval workflow
3. Create `travel_policies` table (max hotel rate by city tier, flight class by trip duration, advance booking requirements)
4. Build a travel request form → manager approval → booking confirmation flow
5. Auto-create expense records from confirmed bookings

**Recommendation**: Start with a simpler approach — build the travel request/approval workflow, and let employees book via their preferred platform. The booking integration can come later.

---

### 4.17 Identity & Access Management (IT)

**What Rippling Does**: Unified SSO (SAML/OIDC), SCIM provisioning, password management, and MFA enforcement across all connected SaaS apps.

#### Key Implementation Notes

This is an enterprise-grade feature that sits at the intersection of HCM and IT.

**Core Components**:
1. **SSO Provider**: Implement SAML 2.0 IdP and OIDC provider capabilities. Your app becomes the identity source. Libraries: `saml2-js` or `passport-saml` for SAML, `oidc-provider` for OIDC.

2. **SCIM Server**: Implement SCIM 2.0 endpoints (`/scim/v2/Users`, `/scim/v2/Groups`) that connected apps call to sync user data. When an employee is created/updated/deactivated in Crew Hub, SCIM pushes changes to all connected apps.

3. **Database**:
   ```sql
   CREATE TABLE sso_apps (
     id uuid PRIMARY KEY, org_id uuid, name varchar, type varchar, -- saml, oidc
     config jsonb, -- {entity_id, acs_url, certificate, etc.}
     scim_config jsonb, -- {endpoint, token}
     is_active boolean, created_at timestamptz
   );

   CREATE TABLE sso_sessions (
     id uuid PRIMARY KEY, user_id uuid, app_id uuid,
     session_token text, ip_address inet,
     created_at timestamptz, expires_at timestamptz
   );
   ```

4. **MFA Enforcement**: Add TOTP support (Google Authenticator compatible) to your auth system. Store MFA seeds encrypted. Enforce per-policy (e.g., "all admins must use MFA").

**Estimated Effort**: 2-3 months for basic SSO + SCIM. MFA adds another 2-3 weeks.

---

### 4.18 Device Management (IT)

**What Rippling Does**: MDM (Mobile Device Management) — push security policies to employee laptops, enforce encryption, remote wipe, software deployment.

#### Key Implementation Notes

Full MDM requires native agents on devices. This is a massive undertaking.

**Pragmatic Approach**:
1. **Asset Tracking Only** (Phase 1): Build an `devices` table tracking: serial number, model, OS, assigned employee, purchase date, warranty expiry, status (active, returned, lost, decommissioned). This is achievable in 1-2 weeks.

2. **MDM Integration** (Phase 2): Integrate with an existing MDM provider (Mosyle, Kandji, Jamf for Mac; Intune for Windows) via their API. Sync device data into your asset table. Push enrollment profiles during onboarding.

3. **Full MDM** (Phase 3): Building your own MDM agent is a multi-year project. Not recommended unless it's a core business differentiator.

---

### 4.19 Mobile App

**What Rippling Does**: Native iOS/Android app for clock-in/out, schedule viewing, time-off requests, pay stubs, expense submission (photo receipt), and push notifications.

#### Key Implementation Notes

**Approach Options**:

1. **React Native** (Recommended): Share business logic and API layer with your web app. Build native UI components. Use Expo for faster development.

2. **PWA** (Quick Win): Convert your Next.js app into a Progressive Web App. Add a `manifest.json`, service worker, and mobile-optimized layouts. Gets you 80% of the value with 20% of the effort.

3. **Capacitor/Ionic**: Wrap your web app in a native container. Access native APIs (camera for receipts, GPS for clock-in, push notifications).

**Priority Mobile Screens**:
1. Clock in/out (with GPS)
2. View schedule
3. Request time off
4. View pay stubs
5. Submit expense (camera → receipt)
6. View notifications
7. Company directory

**Recommended Start**: Build a PWA first (1-2 weeks), then invest in React Native for features needing native APIs (camera, GPS, push notifications).

---

### 4.20 Global Payroll Expansion & EOR

**What Rippling Does**: Run payroll in 100+ countries with local tax compliance. Offer Employer of Record services for countries where the client doesn't have an entity.

#### Key Implementation Notes

Your payroll engine currently supports Nigeria with a sophisticated deduction rules system. Expanding globally requires:

1. **Country Tax Engines**: For each new country, create deduction rules in your existing `deduction_rules` table:
   - **United States**: Federal income tax brackets (progressive), state income taxes (varies by state), FICA (Social Security 6.2% + Medicare 1.45%), FUTA, SUI. Use IRS Publication 15-T tables.
   - **United Kingdom**: PAYE income tax, National Insurance (employee + employer), Student Loan deductions. Use HMRC tax tables.
   - **Canada**: Federal + provincial income tax, CPP, EI. Use CRA tables.
   - **Germany**: Lohnsteuer (wage tax), Solidaritätszuschlag, Kirchensteuer, social insurance (health, pension, unemployment, long-term care).

2. **Statutory Compliance**: Each country has unique requirements — year-end filings (W-2/1099 in US, P60 in UK), statutory reports, pay frequency rules, minimum wage laws. Build a `lib/payroll/countries/` directory with country-specific modules.

3. **EOR**: This is a business model change, not just software. You'd need legal entities in target countries, local bank accounts, and regulatory compliance. Most companies partner with existing EOR providers (Deel, Remote, Oyster) or white-label their services.

**Recommended Priority**:
- Next 3 countries: United States, United Kingdom, Kenya (African expansion)
- Build a generic country engine framework with the Nigeria implementation as the template
- Each new country takes 2-4 weeks including tax table setup and testing

---

### 4.21 Inventory Management (IT)

**What Rippling Does**: Track company assets (laptops, monitors, peripherals), manage inventory levels, automate ordering for new hires.

#### Database Schema

```sql
-- Migration: phase_8.3_inventory.sql

CREATE TABLE inventory_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  -- Item details
  name            varchar(200) NOT NULL,
  category        varchar(60), -- laptop, monitor, phone, headset, keyboard, mouse, other
  brand           varchar(100),
  model           varchar(200),
  serial_number   varchar(100),
  asset_tag       varchar(50),

  -- Status
  status          varchar(20) DEFAULT 'available', -- available, assigned, maintenance, retired, lost
  condition       varchar(20) DEFAULT 'new', -- new, good, fair, poor

  -- Assignment
  assigned_to     uuid REFERENCES profiles(id),
  assigned_at     timestamptz,

  -- Purchase info
  purchase_date   date,
  purchase_price  bigint,
  currency        varchar(3) DEFAULT 'USD',
  vendor          varchar(200),
  warranty_expiry date,

  -- Location
  location        varchar(200),  -- office name or "Remote - Employee Home"

  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE inventory_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  item_id         uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,

  type            varchar(30) NOT NULL, -- assigned, returned, maintenance, retired, lost
  from_employee   uuid REFERENCES profiles(id),
  to_employee     uuid REFERENCES profiles(id),

  notes           text,
  performed_by    uuid REFERENCES profiles(id),

  created_at      timestamptz DEFAULT now()
);
```

---

## 5. Cross-Cutting Concerns

These apply across all new features:

### 5.1 Email Notifications

All new modules need transactional emails. Integrate an email provider once:

```typescript
// lib/email/provider.ts
// Use Resend (recommended), SendGrid, or Postmark
// Create email templates in lib/email/templates/
// Each module calls: await sendEmail({ to, template, data })
```

Key templates needed: welcome email, interview scheduled, offer letter, benefits enrollment confirmation, timesheet reminder, survey invitation, training assigned, shift published, document to sign.

### 5.2 Permissions Expansion

Your current 5-role system (EMPLOYEE, MANAGER, HR_ADMIN, FINANCE_ADMIN, SUPER_ADMIN) will need expansion. Consider adding:

- `RECRUITER` — access to ATS
- `IT_ADMIN` — access to device/identity management
- `BENEFITS_ADMIN` — access to benefits configuration
- `LEARNING_ADMIN` — access to LMS administration

Or better: implement **granular permissions** with a `permissions` table:
```sql
CREATE TABLE role_permissions (
  role_name varchar(40),
  resource  varchar(60),  -- 'benefits', 'recruiting', 'learning', etc.
  action    varchar(20),  -- 'read', 'write', 'admin'
  PRIMARY KEY (role_name, resource, action)
);
```

### 5.3 Audit Logging

All new modules should emit audit log entries. Your existing `audit_log` table and pattern supports this. Ensure every write operation logs the change.

### 5.4 Analytics Integration

Each new module should expose data to your analytics system. Create new RPC functions:
- `analytics_recruiting(...)` — pipeline metrics, time-to-hire, source effectiveness
- `analytics_time_attendance(...)` — attendance rates, overtime trends, absenteeism
- `analytics_learning(...)` — completion rates, overdue training, popular courses
- `analytics_benefits(...)` — enrollment rates, cost per employee, plan popularity

### 5.5 Dashboard Integration

Each new module should contribute to the dashboard API. Add new hero metrics and widgets as modules are built (e.g., "Open Positions: 12", "Pending Timesheets: 5", "Overdue Training: 3").

### 5.6 Workflow Integration

Every new module should emit events to the workflow engine (Section 4.8). This is what makes Rippling's platform so powerful — everything connects to everything.

---

## 6. Recommended Build Order

Based on dependencies, impact, and effort, here's the optimal build sequence:

```
Month 1:
├── E-Signatures (M) ─────────── Unblocks paperless onboarding
├── Time & Attendance (L) ────── Core workforce management
└── Compensation Bands (M) ───── Quick win for comp admin

Month 2:
├── Scheduling (L) ──────────── Pairs with T&A
├── Employee Surveys (M) ────── Quick engagement tool
└── Workflow Studio (XL start)── Begin the platform engine

Month 3:
├── Workflow Studio (continue) ─ Complete visual builder + actions
├── Benefits Administration (XL start) ── Begin schema + enrollment
└── Recruiting & ATS (XL start) ──────── Begin pipeline + careers page

Month 4:
├── Benefits Admin (continue) ── Enrollment wizard + payroll integration
├── Recruiting (continue) ────── Interviews, scorecards, hire flow
└── Policy Engine (L) ────────── Powers rules across platform

Month 5:
├── Learning Management (L) ──── Training + compliance courses
├── Headcount Planning (L) ───── Links to recruiting
└── Chat / Messaging (L) ────── Real-time with Supabase

Month 6:
├── Integration Marketplace (XL start) ── OAuth + first 5 integrations
├── Mobile App / PWA (start) ──────────── PWA first, then React Native
└── Global Payroll - US (L) ─────────── Federal + state tax engines

Months 7-12:
├── Integration Marketplace (continue)
├── Mobile App - React Native
├── Global Payroll - UK, Canada, Kenya
├── Identity & Access Management
├── Bill Pay
├── Travel Management
├── Device Management
├── Inventory Management
└── Corporate Cards (requires banking partner)
```

---

## Summary

Crew Hub is approximately **60-65% of the way to Rippling's feature set** in terms of modules, but the modules you DO have are implemented at a high quality level (especially payroll with country-specific engines, multi-currency support, and multi-provider payment processing).

The biggest gaps that matter most for market competitiveness are:
1. **Benefits Administration** — Must-have for US market
2. **Recruiting / ATS** — Closes the hire-to-retire gap
3. **Workflow Studio** — Rippling's #1 differentiator
4. **Time & Attendance** — Required for hourly workforce
5. **Mobile App** — Expected by modern workforce

Filling these 5 gaps would bring you to roughly **80-85% feature parity** with Rippling's core HCM offering. The remaining features (corporate cards, MDM, travel, etc.) are expansion modules that even many Rippling customers don't use.
