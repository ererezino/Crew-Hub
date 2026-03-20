# Payroll Reset Handoff

This folder is the canonical handoff pack for correcting payroll product drift.

Use it when handing the payroll work to an agent so the source of truth lives in the repo instead of in chat history.

## Read Order

1. `docs/payroll-reset/PAYROLL_REALIGNMENT_BRIEF.md`
2. `docs/payroll-reset/PAYROLL_AGENT_HANDOFF.md`

## What Each File Is For

- `PAYROLL_REALIGNMENT_BRIEF.md`
  - The product definition.
  - Explains the real payroll workflow, the mismatch in the current build, and the corrected target state.
- `PAYROLL_AGENT_HANDOFF.md`
  - Copy-paste prompts for the agent.
  - Includes:
    - analysis prompt
    - implementation prompt
    - final-warning prompt

## One-Line Instruction To The Agent

Read `docs/payroll-reset/PAYROLL_REALIGNMENT_BRIEF.md` first, then follow `docs/payroll-reset/PAYROLL_AGENT_HANDOFF.md`. The payroll product must be corrected to match the real semimonthly worksheet workflow, not the current generic payout-cycle interpretation.

## Recommended Use

1. Start with the analysis prompt.
2. Review the agent's `Current State / Target State / Gap List / Keep / Reshape / Remove / Recommended Build Order` response.
3. If the analysis is solid, use the implementation prompt.
4. If the agent starts drifting again, use the final-warning prompt without rewriting it.
