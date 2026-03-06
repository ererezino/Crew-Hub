# Crew Hub Design Audit: Execution Guide

## What this is

7 prompts that bring Crew Hub into full compliance with the brand guidelines. Each prompt is a self-contained task for Claude Code. Run them in order.

## Setup

```bash
# 1. Add brand guidelines to repo
mkdir -p docs/brand
cp /path/to/crew-hub-brand-guidelines.html docs/brand/

# 2. Add the audit prompts
mkdir -p docs/audit
# Copy 01 through 07 into docs/audit/

# 3. Commit so the agent can find them
git add docs/brand docs/audit
git commit -m "Add brand guidelines and design audit prompts"
```

## Run

```bash
# Phase 1: Colour tokens, typography (Playfair + DM Sans), spacing, dark mode
cat docs/audit/01-design-tokens.md | claude --dangerously-skip-permissions
git add -A && git commit -m "Phase 1: Design tokens and typography"

# Phase 2: Button (CTA/Primary/Ghost/Danger), EmptyState, ErrorState, StatusChip, currency formatter, Card, Input, Select
cat docs/audit/02-core-components.md | claude --dangerously-skip-permissions
git add -A && git commit -m "Phase 2: Core UI components"

# Phase 3: Login, Performance (DB fix), Compensation Bands, People, Notifications
cat docs/audit/03-critical-pages.md | claude --dangerously-skip-permissions
git add -A && git commit -m "Phase 3: Critical page fixes"

# Phase 4: Currency symbols (₦, $, GH₵, KSh, R, CA$), Back to dashboard removal, sidebar icons, No department, native select replacement, em dashes, voice quick fixes
cat docs/audit/04-global-fixes.md | claude --dangerously-skip-permissions
git add -A && git commit -m "Phase 4: Global fixes"

# Phase 5: EmptyState and ErrorState on every page, skeleton loader timeouts
cat docs/audit/05-empty-error-states.md | claude --dangerously-skip-permissions
git add -A && git commit -m "Phase 5: Empty and error states"

# Phase 6: Button variant assignment on every page (1 CTA max, verb-first labels)
cat docs/audit/06-button-variants.md | claude --dangerously-skip-permissions
git add -A && git commit -m "Phase 6: Button variants"

# Phase 7: Playfair on headings, voice audit, Roles & Access redesign, dashboard polish, final sweep
cat docs/audit/07-copy-voice-polish.md | claude --dangerously-skip-permissions
git add -A && git commit -m "Phase 7: Copy, voice, and polish"
```

## What each phase does

| # | File | Scope | Key changes |
|---|------|-------|-------------|
| 01 | 01-design-tokens.md | globals.css, tailwind.config, layout | Cream canvas, warm borders, brand palette, Playfair + DM Sans, type scale, spacing, dark mode on Navy |
| 02 | 02-core-components.md | components/ui/ | Button variants (CTA/Primary/Ghost/Danger/Disabled), EmptyState, ErrorState (with error sanitization), StatusChip (5 statuses), currency formatter (₦, $, GH₵, KSh, R, CA$), Card, Input, Select |
| 03 | 03-critical-pages.md | 5 pages | Login rebrand (cream, Accrue wordmark, orange CTA), Performance DB schema fix, Comp Bands empty states, People error handling, Notifications |
| 04 | 04-global-fixes.md | 30+ files | Currency symbol formatting everywhere, "Back to dashboard" removal (10+ instances), sidebar Lucide icons, "No department" removal, native select replacement, em dash removal |
| 05 | 05-empty-error-states.md | 25+ pages | Brand-compliant EmptyState on every empty page, ErrorState on every error, skeleton loader timeouts (10s), correct copy for each context |
| 06 | 06-button-variants.md | 20+ pages | Exactly 1 CTA (Orange) per page, Primary (Black) for section actions, Ghost for tertiary, verb-first labels on every button |
| 07 | 07-copy-voice-polish.md | all files | Playfair Display on H1/H2, metric label typography, page description cleanup, full voice audit (crew not staff, ops not HR, no jargon, no em dashes, no passive voice), Roles & Access card layout, dashboard polish, final 20-point verification |

## If something breaks

Each phase ends with verification checks. If checks fail, the agent is instructed to fix them before finishing. If a session ends with failures:

1. Re-run the same prompt: `cat docs/audit/0X-name.md | claude --dangerously-skip-permissions`
2. If a phase corrupts a previous phase: `git revert HEAD` and re-run

## After all 7 phases

Run the final verification from Phase 7 manually to confirm everything passes. Then visually review the app in a browser.

The prompts handle everything that can be verified programmatically (grep checks, build, TypeScript). Visual issues like spacing, font rendering, contrast on cream backgrounds, and chart colours need your eye.

## Currency reference

| Currency | Code | Symbol | Example output |
|----------|------|--------|---------------|
| Nigerian Naira | NGN | ₦ | ₦150,000.00 |
| US Dollar | USD | $ | $1,500.00 |
| Ghanaian Cedi | GHS | GH₵ | GH₵1,500.00 |
| Kenyan Shilling | KES | KSh | KSh1,500.00 |
| South African Rand | ZAR | R | R1,500.00 |
| Canadian Dollar | CAD | CA$ | CA$1,500.00 |
| British Pound | GBP | £ | £1,500.00 |
| Euro | EUR | € | €1,500.00 |
