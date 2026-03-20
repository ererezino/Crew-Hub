# Crew Hub Payroll Realignment Brief

## Purpose

This brief corrects the payroll product direction.

It replaces the current generic payout-cycle interpretation with the real finance operating model used today.

The goal is not to invent a flexible payroll engine.
The goal is to make Crew Hub behave like the real semimonthly payroll process, but in a more automated, audit-ready, and easier-to-operate way than the current spreadsheet and email workflow.

## Source Of Truth

This brief is based on the real payroll process and the worksheet at:

- `/Users/zinoasamaige/Downloads/Accrue Employee Payroll - December 2025.csv`

The product must match the real finance workflow, not an abstract generic payroll engine.

## Current State

- The current product is centered on a generic payroll run and flexible payout-cycle engine.
- Finance can create and manage payout cycles, but the system does not treat first-Friday and third-Friday payroll as the core product rule.
- Finance oversight exists mainly as dashboard content, not as a durable finance workspace.
- The governance foundations are strong:
  - approval controls
  - salary approval separation of duties
  - payment-detail hold controls
  - historical publication controls
  - employee visibility truth rules
  - audit logging foundations
- The finance UX does not yet behave like the worksheet-driven operating process used by finance today.
- The product does not yet present payroll as a row-level monthly worksheet with explicit Cycle 1 and Cycle 2 planning.
- Export behavior does not yet clearly match the required finance audit output of what was approved and what was paid.

## Target State

- The primary payroll object is a Monthly Payroll Run.
- Every monthly payroll run has two normal payout cycles by default:
  - Cycle 1 = first Friday
  - Cycle 2 = third Friday
- Default salary split is 50/50 across those two cycles.
- Finance works from a worksheet-like employee list.
- Finance can review and edit row-level payroll details before submission:
  - salary-derived cycle amounts
  - overtime
  - bonus
  - fees or deductions
  - comments
  - inclusion or exclusion
  - exception reasons
- Each cycle can be submitted for approval as a frozen snapshot.
- CFO or COO approves or rejects the exact cycle snapshot.
- After external disbursement, finance marks the approved cycle paid.
- Paid cycles become immutable.
- Finance can export CSV and PDF records of what was approved and paid.
- Finance Oversight is a real finance surface, not just a dashboard section.
- My Pay remains truth-first and only reflects actually paid cycles.

## Gap List

- No first-class semimonthly payroll model.
- No explicit first-Friday and third-Friday payroll structure.
- No default 50/50 cycle split as the main business rule.
- No worksheet-first finance operating screen.
- No row-level monthly payroll editing experience that mirrors the spreadsheet.
- No dedicated Cycle 1 and Cycle 2 preparation workflow as the main path.
- No clear frozen cycle approval snapshot as the center of CFO or COO review.
- No dedicated Finance Oversight page or submenu.
- No clear cycle-level CSV or PDF audit export pack as a first-class feature.
- Too much emphasis on flexible generic payout cycles as the primary workflow.

## Non-Negotiable Product Rules

1. Payroll is semimonthly by default.
2. Every month has two normal cycles:
   - Cycle 1 = first Friday
   - Cycle 2 = third Friday
3. Default salary split is 50/50 across the two cycles.
4. Finance must review a list of employees before submission.
5. Finance must be able to correct row-level amounts before submission.
6. Overtime must be editable for the relevant cycle period.
7. Exceptions are allowed, but they must be explicit and auditable.
8. Approvers must review the exact submitted cycle snapshot, not a moving target.
9. Paid cycles become immutable.
10. Employee-facing visibility must remain truthful.
11. Finance needs CSV and PDF export after approval and payment.

## Manual Exceptions And Future-Proofing

This product must be opinionated by default and flexible by exception.

### Default Path

The normal payroll path is:

- monthly payroll run
- Cycle 1 = first Friday
- Cycle 2 = third Friday
- default monthly salary split = 50/50
- finance reviews the employee list
- finance submits a cycle snapshot for approval
- approver approves or rejects
- finance pays externally
- finance marks the cycle paid
- system generates export and audit records

### Manual Exceptions Must Be Allowed

Finance must be able to handle real-world exceptions, including:

- full pay in one cycle
- uneven split across the two cycles
- skipped employee in a cycle
- terminated employee still needing payment
- late-added employee
- overtime anomaly
- one-off bonus
- fee or deduction adjustment
- manual correction to a row
- custom comment or note for an exception

### Exception Rules

Manual flexibility is allowed only if it is explicit and auditable.

For any material override, the system should require:

- reason or comment
- actor
- timestamp
- visibility in approval snapshot
- visibility in exports or audit output where relevant

### Auditability Rule

The system must never allow hidden manual work.

If finance changes:

- cycle amount
- overtime
- inclusion or exclusion
- bonus
- fees
- comment affecting payout

that change must be visible in:

- audit trail
- approval review context
- export output where relevant

### Immutability Rule

After a cycle is submitted for approval, the submitted snapshot is frozen.
After a cycle is marked paid, it becomes immutable.

If changes are needed after submission:

- reject and resubmit
- or reopen through an explicit governed workflow

### Future-Proofing Rule

The system may support future exception flows, such as:

- off-cycle corrections
- ad hoc catch-up payments
- special one-time payouts

But these must be modeled as explicit exception workflows, not as the primary payroll path.

The primary payroll path remains:

- monthly worksheet
- first Friday
- third Friday
- 50/50 default split

## Primary Product Model

### 1. Monthly Payroll Run

This is the primary payroll object.

Suggested fields:

- month
- year
- org
- cycle_1_date
- cycle_2_date
- run_status
- created_by
- reviewed and approved metadata
- payment metadata
- audit metadata

A monthly payroll run contains:

- employee payroll rows
- Cycle 1 plan
- Cycle 2 plan
- approval snapshots
- payment and export records

### 2. Payroll Row

One row per employee in the monthly worksheet.

Suggested fields:

- employee_id
- employee_name
- designation
- department
- accrue_username
- monthly_salary
- fees
- bonus
- overtime_eligible
- overtime_rate
- cycle_1_hours
- cycle_1_overtime_amount
- cycle_2_hours
- cycle_2_overtime_amount
- cycle_1_included
- cycle_2_included
- cycle_1_amount
- cycle_2_amount
- monthly_total
- comment
- exception_reason
- row_status
- last_edited_by
- last_edited_at

### 3. Approval Snapshot

When finance submits a cycle for approval, the system must freeze the submitted row list for that cycle.

The approver must review:

- exact employees included
- exact amounts
- overtime
- bonuses and fees
- comments and exceptions
- totals
- submitter
- submitted timestamp

After submission, finance cannot silently change that approval payload.

### 4. Payment Completion Record

After approval and external payment:

- finance marks cycle paid
- enters payment reference or payout note
- system timestamps payment completion
- cycle becomes immutable
- export files become available

## Navigation / Information Architecture

Finance needs a real operating area.

Under Finance, create:

- Payroll
- Finance Oversight
- Compensation

Do not leave finance oversight trapped inside the dashboard as the primary surface.
Dashboard summary cards are fine, but the real workspace must be a dedicated finance surface.

## Required Screens

### Screen A. Payroll Runs List

Purpose:

- See all monthly payroll runs
- Track cycle status at a glance
- Open the month

Columns or cards:

- month
- Cycle 1 date and status
- Cycle 2 date and status
- employee count
- total monthly planned payout
- approval state
- payment state

Actions:

- create month
- open month
- export month summary
- view audit

### Screen B. Monthly Payroll Worksheet

This is the core finance operating screen.
It should feel like the spreadsheet, not like an abstract run details page.

One row per employee.
Finance must be able to:

- see everyone being paid
- confirm amounts
- edit overtime
- edit bonuses, fees, and comments
- adjust cycle split where needed
- include or exclude employee from a cycle
- add exception reason where default split is overridden

Columns should map closely to the current spreadsheet:

- Employee Name
- Designation
- Department
- Accrue Username
- Monthly Salary
- Fees
- Bonus
- Comment
- Overtime Rate
- Cycle 1 Hours
- Cycle 1 Overtime
- Cycle 2 Hours
- Cycle 2 Overtime
- Cycle 1 Amount
- Cycle 2 Amount
- Monthly Total

This screen must support finance review before submission.

### Screen C. Cycle Review / Prepare

Finance selects either:

- Prepare Cycle 1
- Prepare Cycle 2

The cycle view shows only the employees included in that cycle.

Columns:

- employee
- base cycle amount
- overtime hours
- overtime amount
- bonus or adjustment
- fees
- final payable
- comment or exception reason

Cycle totals at the bottom:

- employee count
- total base pay
- total overtime
- total adjustments
- final payout total

### Screen D. Approval Review

The approver sees the exact submitted cycle.
Not the live worksheet.
A frozen approval snapshot.

Approver actions:

- approve
- reject with reason

Rules:

- reviewer and approver actions must be audited
- rejected cycle returns to finance with visible rejection reason
- approved cycle locks the cycle for payment preparation

### Screen E. Payment Completion

After external payout:

- finance opens the approved cycle
- marks it paid
- enters payment reference or note
- optionally confirms payment date if not automatic

After this:

- cycle status becomes paid and completed
- cycle becomes immutable
- export actions become available

### Screen F. Finance Oversight

This must be a dedicated finance page, not dashboard-only.

Sections:

- payroll cycles awaiting approval
- salary changes awaiting approval
- historical payroll awaiting action
- rejected cycles needing correction
- payout blockers and held payment details
- paid cycles ready for export or archive

### Screen G. Employee My Pay

The employee experience must remain trust-first.

Employees should see:

- nothing before first actual paid cycle
- Cycle 1 visible once actually paid
- Cycle 2 visible once actually paid
- partial month state clearly labeled
- historical imported periods clearly labeled
- downloadable statements only when real statements are available

## Workflow

### Monthly Setup

1. Finance creates the month.
2. The system auto-generates:
   - Cycle 1 date = first Friday
   - Cycle 2 date = third Friday
3. The system preloads active employees and approved salary data.
4. The system defaults:
   - Cycle 1 amount = 50% of salary
   - Cycle 2 amount = 50% of salary

### Finance Preparation

1. Finance reviews the worksheet list.
2. Finance edits:
   - overtime
   - bonus
   - fees
   - comments
   - exceptions to split
3. Exceptions require reason.
4. Finance opens Cycle 1 or Cycle 2 preview.

### Approval

1. Finance submits the cycle.
2. The system freezes a cycle snapshot.
3. CFO or COO reviews the exact list.
4. The approver either:
   - approves
   - rejects with reason

### Payment

1. Finance pays externally.
2. Finance marks the cycle paid.
3. The system timestamps paid state.
4. The system updates employee-visible truth only for actually paid cycles.
5. The system generates payment and export evidence.

## Default Rules

- Default monthly salary split: 50/50
- Default cycle dates: first Friday and third Friday
- Overtime must be entered against the relevant cycle period
- Full-month single-cycle payment is allowed only with comment or reason
- Custom split is allowed only with comment or reason
- Removed or terminated staff can still be included if intentionally selected with comment
- Paid cycle rows are immutable

## Exports

After each paid cycle, finance must be able to download:

### CSV Export

Must include:

- month
- cycle
- employee
- department
- designation
- username
- monthly salary
- cycle base amount
- overtime hours
- overtime rate
- overtime amount
- bonus
- fees
- final payable
- approver
- approval timestamp
- paid timestamp
- payment reference
- comment

### PDF Export

Must function as an audit pack:

- month
- cycle
- submitter
- approver
- approval timestamp
- paid timestamp
- payment reference
- totals
- row list
- exception notes and comments

## Audit Requirements

Everything meaningful must be auditable:

- who created the month
- who edited a row
- who changed cycle amounts
- who changed overtime
- who submitted a cycle
- who approved or rejected
- who marked paid
- what export was generated and when

## Keep / Reshape / Remove

### Keep

- role model and permission structure
- approval governance and separation of duties
- salary approval workflow
- payment-detail hold and verification controls
- historical publication governance
- truthful employee visibility controls
- audit infrastructure already built

### Reshape

- payroll run detail into a worksheet-first finance experience
- generic payout cycles into explicit Cycle 1 and Cycle 2 workflow
- dashboard-only oversight into a dedicated Finance Oversight surface
- current finance review UX into spreadsheet-style row review and correction
- current cycle prep flow into cycle-specific review, approval, and payment flow
- current outputs into proper cycle and month audit exports

### Remove / De-emphasize

- arbitrary payout-cycle creation as the main finance workflow
- dashboard cards as the primary oversight experience
- engine-first product framing
- generic flexible-cycle UX that hides the real semimonthly payroll model
- any finance UX that does not begin from the full employee payroll list

## Recommended Build Order

### 1. Information Architecture Reset

- Add a dedicated Finance Oversight page or submenu under Finance.
- Reframe Payroll around monthly runs and explicit Cycle 1 and Cycle 2.

### 2. Data Model Realignment

- Ensure the payroll model supports:
  - month
  - Cycle 1 date
  - Cycle 2 date
  - row-level cycle amounts
  - overtime by cycle
  - exception reason and comments
  - approval snapshot metadata
  - payment reference metadata
  - export metadata

### 3. Worksheet UI

- Build the monthly payroll worksheet as the primary finance operating screen.
- Show a full employee list and payroll columns close to the spreadsheet.

### 4. Cycle Review Flow

- Add explicit Prepare Cycle 1 and Prepare Cycle 2 flows.
- Show only employees included in the chosen cycle.
- Freeze a cycle snapshot on submit.

### 5. Approval Flow Refinement

- CFO or COO reviews the exact submitted cycle snapshot.
- Approve or reject with reason.
- Approved cycle becomes payment-ready.

### 6. Payment Completion

- Finance marks an approved cycle paid after external disbursement.
- Payment reference or note is recorded.
- Cycle becomes immutable.

### 7. Exports

- Add cycle-level CSV export.
- Add cycle-level PDF audit pack.
- Add optional monthly summary export if useful.

### 8. Finance Oversight

- Build the dedicated finance surface for:
  - cycles awaiting approval
  - salary approvals
  - historical action
  - payout blockers
  - rejected cycles needing correction
  - paid cycles ready for export or archive

### 9. My Pay Alignment

- Keep My Pay truthful.
- Show only actually paid cycle truth.
- Keep partial, full, and historical states clear.

### 10. Cleanup

- De-emphasize or retire generic cycle-first affordances that conflict with the semimonthly worksheet model.
- Update copy, tests, and documentation to match the corrected product.

## What Success Looks Like

Finance can stop using the spreadsheet for operational payroll preparation.

Instead, they can:

- open the month in Crew Hub
- review the full employee payroll list
- make row-level corrections
- submit Cycle 1 or Cycle 2 for approval
- get CFO or COO approval inside the system
- mark the cycle paid after external disbursement
- download CSV and PDF records of what was approved and paid

That is the target product.
Not a generic payroll engine.
A Crew Hub version of the real payroll worksheet workflow.
