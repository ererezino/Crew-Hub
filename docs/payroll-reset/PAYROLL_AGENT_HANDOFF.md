# Payroll Reset Agent Handoff

Use the prompts in this file exactly as written.

Before using any prompt in this file, instruct the agent to read:

- `docs/payroll-reset/PAYROLL_REALIGNMENT_BRIEF.md`

## Prompt 1: Analysis First

```text
Read `docs/payroll-reset/PAYROLL_REALIGNMENT_BRIEF.md` first.

Use that brief as the product definition.

You are correcting product drift.

The source of truth is the real finance payroll process and the worksheet at:
`/Users/zinoasamaige/Downloads/Accrue Employee Payroll - December 2025.csv`

Do not continue building from the assumption that the current generic payout-cycle engine is the intended product.
It is not.

The intended product is:
- monthly payroll worksheet
- first Friday cycle
- third Friday cycle
- default 50/50 split
- row-level finance review
- CFO/COO approval of exact submitted cycle snapshot
- external payment after approval
- mark-paid inside Crew Hub
- CSV/PDF audit exports
- Finance Oversight as a real finance workspace

NON-NEGOTIABLE RULES
1. Payroll is semimonthly by default.
2. Each month has two normal cycles:
   - Cycle 1 = first Friday
   - Cycle 2 = third Friday
3. Default split is 50/50.
4. Finance must work from a LIST/TABLE of employees.
5. Finance must be able to review and correct row-level figures before submission.
6. Overtime must be editable for the relevant cycle period.
7. Exceptions are allowed, but must be explicit and auditable.
8. Approvers must review a frozen cycle snapshot, not a moving target.
9. Paid cycles become immutable.
10. Finance must be able to export what was approved and what was paid.

MANUAL EXCEPTIONS MUST BE SUPPORTED
The product must allow controlled manual exceptions such as:
- full payment in one cycle
- uneven split
- bonus
- fees/deductions
- overtime anomaly
- terminated employee payment
- skipped cycle inclusion
- correction row

But manual flexibility must never be hidden.
For any material override, require:
- reason/comment
- actor
- timestamp
- audit trail
- visibility in approval review
- visibility in exports where relevant

WHAT YOU MUST DO NOW
1. Compare the current implementation to this corrected payroll model.
2. Organize your analysis in exactly these sections:
   - Current State
   - Target State
   - Gap List
   - Keep / Reshape / Remove
   - Recommended Build Order
3. Be concrete. Name what in the current build is already worth keeping.
4. Be equally concrete about what must be reshaped or de-emphasized.
5. Do not defend the current generic model if it contradicts the real semimonthly workflow.
6. After the analysis, propose the implementation sequence needed to move Crew Hub from the current state to the corrected product.

Your implementation sequence must explicitly cover:
- navigation / information architecture
- data model changes if needed
- worksheet UI
- cycle review and approval
- payment completion
- exports
- oversight page
- My Pay impact

Do not come back with another generic payroll proposal.
The real finance process is the product.
Build that.
```

## Prompt 2: Execution

```text
Read `docs/payroll-reset/PAYROLL_REALIGNMENT_BRIEF.md` first.

Stop building around the current generic engine.

You are now implementing the payroll reset spec.
Do not improvise the product shape.
Do not optimize for abstract flexibility over workflow fidelity.

The target product is:
- a monthly payroll worksheet
- one row per employee
- two fixed semimonthly cycles
- first Friday and third Friday
- 50/50 default salary split
- row-level finance review and correction
- approval of the exact submitted cycle snapshot
- mark-paid after external disbursement
- CSV/PDF export of approved/paid records
- dedicated Finance Oversight page

This is the acceptance bar:
if the product still feels like a generic payout engine instead of a Crew Hub version of the real payroll worksheet process, then the work is not done.

IMPLEMENTATION RULES
1. Finance must start from a LIST of employees.
2. Cycle 1 and Cycle 2 must be first-class.
3. Default payroll behavior must reflect first-Friday / third-Friday and 50/50 split.
4. Exceptions must be explicit, auditable, and reviewable.
5. Paid cycles must become immutable.
6. Oversight must not live only in the dashboard.
7. Exports must be real first-class outputs.
8. Employee My Pay truth must not regress.

DO NOT DO THESE THINGS
- do not keep arbitrary payout-cycle creation as the main flow
- do not keep dashboard cards as the primary finance oversight surface
- do not replace the worksheet model with a generic run-details page
- do not hide manual exceptions in a way that bypasses auditability
- do not come back with “close enough”

WHAT I WANT BACK
Return only when you have:
1. implemented the agreed phase
2. verified it in code
3. verified the workflow makes sense against the real spreadsheet process
4. committed it cleanly

When you report back, use exactly this format:
1. Exact files changed
2. Exact product behavior after the change
3. Exact workflow for finance
4. Exact workflow for approver
5. Exact workflow for mark-paid/export
6. Exact manual exception handling
7. Tests added/updated
8. Commit SHA
9. Clean working tree
10. Typecheck / build / test status
11. Browser verification summary

Do not send another vague checkpoint.
Do not send another backend-heavy update and call it product-complete.
The real finance process is the product.
Implement that.
```

## Prompt 3: Final Warning

```text
Read `docs/payroll-reset/PAYROLL_REALIGNMENT_BRIEF.md` first.

Final warning: do not send another incomplete checkpoint.

I am done with near-miss payroll submissions.

You are not authorized to report this as complete unless the product now clearly behaves like our real semimonthly payroll workflow:
- monthly worksheet
- employee list
- first Friday
- third Friday
- 50/50 default split
- row-level correction
- approver snapshot review
- external payment then mark paid
- CSV/PDF audit export
- real Finance Oversight page

If the result still feels like a generic payout engine with flexible cycles, then you have not done the job.

Do not return early.
Do not send “mostly done.”
Do not send “the backend supports it.”
Do not send “we can polish later.”

Come back only when:
- the product shape matches the real process
- the UI reflects that process
- the oversight information architecture reflects that process
- the exports exist
- the manual exception path is controlled and auditable
- the working tree is clean
- the code is committed
- the tests, build, and typecheck pass
```

## Suggested Message To Send With The Prompt

```text
Read `docs/payroll-reset/PAYROLL_REALIGNMENT_BRIEF.md` first.
Then use the appropriate prompt from `docs/payroll-reset/PAYROLL_AGENT_HANDOFF.md`.
Do not rely on prior chat assumptions. The repo brief is now the source of truth.
```
