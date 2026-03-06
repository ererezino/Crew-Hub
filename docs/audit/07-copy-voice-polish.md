Read `docs/brand/crew-hub-brand-guidelines.html` first. This is the final phase. After this, every surface must match the brand.

Your task: apply serif typography to headings, audit all user-facing copy for brand voice compliance, polish remaining UI details, and run a final verification sweep across the entire codebase.

RULES:
- Read every file before editing.
- No em dashes anywhere in user-facing text.
- Crew-first language always. The person is the subject, not the system.
- Sentence case for all UI text (not Title Case).
- Headlines (H1, H2) use Playfair Display (serif). Everything else uses DM Sans (sans).
- Build at the end. Everything must compile.

STEP 1: TYPOGRAPHY ON PAGE HEADINGS

The brand says: "Headlines and openers use Playfair Display. All UI, labels, body, and buttons use DM Sans."

Currently, page titles are probably all sans-serif. They need to be serif.

Find how page titles are rendered:
```bash
# Find page header patterns
grep -rn "PageHeader\|page-header\|<h1\|<h2\|page.*title\|pageTitle" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | head -30

# Find if there's a shared PageHeader component
find . -iname "*page*header*" -o -iname "*page-header*" 2>/dev/null | grep -v node_modules

# Check how the current H1/H2 classes map to fonts
grep -rn "text-2xl\|text-3xl\|text-xl\|font-bold.*text-" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | head -20
```

Apply Playfair Display to:
- Page titles (H1): the main title on each page like "Payroll", "Time Off", "Analytics"
  Style: `font-serif text-[28px] font-bold tracking-[-0.02em]`
- Section headings (H2): section titles within pages like "Coverage summary", "Recent audit log", "My Requests"
  Style: `font-serif text-[22px] font-bold tracking-[-0.015em]`

Do NOT apply serif to:
- H3 module titles (these stay DM Sans: `text-[17px] font-semibold tracking-[-0.01em]`)
- Button labels
- Table headers
- Form labels
- Badge/chip text
- Metric card labels (these are Label style: 11px uppercase tracked)
- Navigation items
- Page descriptions/subtitles (these are body text, DM Sans)

If there is a shared PageHeader component: update it to apply `font-serif` to the title. This fixes all pages at once.

If each page sets its own `<h1>`: you need to update each one. Add `font-serif` to the className. Do ALL of them:

```bash
find . -name "page.tsx" -path "*/app/*" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | sort
```

Open each page. Find the h1/title element. Add serif font class.

STEP 2: METRIC CARD LABELS

Metric cards (like on Dashboard, Payroll, Expenses, Analytics, Hours) have uppercase labels like "HEADCOUNT", "TOTAL COST", "YTD GROSS". These should match the Label type spec: DM Sans 11px Bold, uppercase, tracking 0.12em.

```bash
grep -rn "uppercase\|UPPERCASE\|tracking-wide\|tracking-wider" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | head -20
```

Check the current metric card label styling. Update to:
`text-[11px] font-bold uppercase tracking-[0.12em] text-crew-gray1`

If there's a shared MetricCard component, update it once. If labels are inline, update each occurrence.

STEP 3: PAGE DESCRIPTIONS

Page descriptions (the subtitle below the page title) should be: DM Sans 15px, #495057 (Gray 1), sentence case, no trailing period.

```bash
# Find page descriptions
grep -rn "description\|subtitle\|page.*desc\|subheading" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | head -20
```

Check each page description string. Fix:
- Remove trailing periods: "Build, publish, and manage team shift schedules." -> "Build, publish, and manage team shift schedules"
- Sentence case: no words capitalized except the first and proper nouns
- Replace "organization" with "the crew" or "the team" where it makes sense
- Replace "employees" with "crew members"
- No em dashes

STEP 4: COMPREHENSIVE VOICE AUDIT

Go through every user-facing string in the codebase:

```bash
# "employees" / "staff" / "personnel"
grep -rn '".*employee\|".*staff\|".*personnel\|".*workforce' --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui\|interface\|type \|import\|const \|//\|.test." | head -20

# "HR" / "human resources"
grep -rn '".*HR \|".*HR"\|human resources\|Human Resources' --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v "import\|const \|type \|interface\|//\|.test." | head -10

# "PTO"
grep -rn "PTO\|pto" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v ".test." | head -10

# "line manager"
grep -rn "line manager\|Line Manager\|Line manager" --include="*.tsx" . 2>/dev/null | grep -v node_modules | head -10

# "submit a ticket" / "raise a request"
grep -rn "submit a ticket\|raise a request" --include="*.tsx" . 2>/dev/null | grep -v node_modules | head -10

# Corporate jargon
grep -rn "leverage\|synergy\|synergize\|circle back\|touch base\|action item\|deliverable\|utilize\|utilise\|please be advised\|kindly\|as per\|going forward\|moving forward" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v ".test." | head -20

# Passive voice in confirmations/instructions
grep -rn "has been processed\|has been submitted\|has been updated\|has been created\|has been deleted\|was processed\|was submitted\|is being processed" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v ".test." | head -20

# "Submit" as a button label (should be specific verb)
grep -rn ">Submit<\|'Submit'\|\"Submit\"" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v ".test.\|onSubmit\|handleSubmit\|form" | head -10

# Em dashes (final check)
grep -rn "—\|–" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v ".test.\|format-currency\|CURRENCY" | head -20

# Title Case in descriptions (look for patterns like "And The")
grep -rn '"[A-Z][a-z].*[A-Z][a-z].*[A-Z]' --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "import\|const \|interface\|type \|className\|components/ui" | head -15
```

For every match, read the context and fix:
- "employees" -> "crew" or "crew members" (in user-facing text, not database column names)
- "staff" -> "crew"
- "HR department" -> "ops" or "people ops"
- "PTO" -> "leave"
- "line manager" -> "manager"
- "has been submitted" -> "Done. Your request is sent." or "Sent. Your manager will review it."
- "has been processed" -> "Done." or specific outcome
- "Submit" button -> specific verb like "Send request", "Save changes", "Create policy"
- Remove all em dashes from user-facing strings
- Corporate jargon: rewrite in plain language

STEP 5: ROLES & ACCESS PAGE

```bash
find . -path "*access*control*" -o -path "*roles*" -name "*.tsx" 2>/dev/null | grep -v node_modules | grep -v .next | head -5
```

Read the page. Currently it shows roles as plain text lists. Redesign:

1. Each role (Employee, Team Lead, Manager, HR Admin, Finance Admin, Super Admin) gets its own Card (`bg-card border border-border rounded-xl p-6`).
2. Role name: `font-serif text-[22px] font-bold` (H2 level, Playfair)
3. Permissions list: render as inline chips/badges with `flex flex-wrap gap-2`. Each chip: `inline-flex items-center rounded-lg bg-crew-dust text-crew-gray1 text-[13px] px-2.5 py-1`
4. Cards laid out in a 2-column or 3-column grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
5. "Per-Person Overrides" section below: keep existing structure, just make sure it uses body text styling.

STEP 6: DASHBOARD POLISH

```bash
find . -path "*dashboard*" -o -path "*home*" -name "page.tsx" 2>/dev/null | grep -v node_modules | grep -v .next | head -5
```

1. Verify duplicate "Recent audit activity" is removed (done in Phase 3). If it's still there, remove it now.
2. Welcome card: "Good morning, Zino." is great. Verify it uses serif for the greeting (H1 or H2 level).
3. Metric cards inside welcome: labels should be Label style (11px bold uppercase tracked). Values should be large (24px+ semibold).
4. Bottom card grid (Announcements, Team on leave, Leave balance, Approvals, Payroll status, Compliance health): verify `grid grid-cols-1 md:grid-cols-3 gap-4` with equal-height cards via grid auto-rows.
5. "My leave balance" card: if it shows `annual_leave` as a raw string, format as "Annual leave" (sentence case, remove underscores).
6. "Needs Attention" alert card: the left orange border is correct for the brand (highlighted/pinned card pattern). Keep it.

STEP 7: TABLE HEADERS

Check table components across the app. Table headers should use Label style:

```bash
grep -rn "TableHeader\|table-header\|<th\|thead" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | head -20
```

Table header cells: `text-[11px] font-bold uppercase tracking-[0.12em] text-crew-gray1`. If there's a shared Table component, update the header styling once. If tables are built inline, check Approvals, Expenses, Expense Reports, and Time Off tables.

Table body rows: `text-[15px] text-foreground`, min-height 48px, hover state `hover:bg-muted/50`.

STEP 8: FINAL VERIFICATION SWEEP

```bash
echo "============================================"
echo "  CREW HUB DESIGN AUDIT: FINAL VERIFICATION"
echo "============================================"

echo ""
echo "--- COLOUR SYSTEM ---"

echo "Cream canvas defined:"
grep -c "FFFAF3\|fffaf3\|37 100% 97%" $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "Warm border defined:"
grep -c "E8DFD0\|e8dfd0\|36 30% 86%" $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "Crew Navy defined:"
grep -c "1A2B3C\|1a2b3c" $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "Crew Sage defined:"
grep -c "2D6A4F\|2d6a4f" $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo ""
echo "--- TYPOGRAPHY ---"

echo "Playfair Display loaded:"
grep -rn "Playfair" --include="*.css" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | wc -l

echo "DM Sans loaded:"
grep -rn "DM.Sans\|DM_Sans\|dmSans" --include="*.css" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | wc -l

echo "Serif on page headings:"
grep -rn "font-serif" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui\|tailwind" | wc -l

echo ""
echo "--- COMPONENTS ---"

echo "Button CTA variant exists:"
grep -c "cta" $(find . -path "*/components/ui/button*" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "EmptyState component exists:"
find . -iname "*empty*state*" -path "*/components/*" -not -path "*/node_modules/*" 2>/dev/null | wc -l

echo "ErrorState component with sanitization:"
grep -c "sanitize\|technicalPattern\|does not exist" $(find . -iname "*error*state*" -path "*/components/*" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "StatusChip component:"
find . \( -iname "*status*chip*" -o -iname "*status*badge*" \) -path "*/components/*" -not -path "*/node_modules/*" 2>/dev/null | wc -l

echo "Currency formatter with proper symbols:"
grep -c "₦\|GH₵\|KSh" $(find . -iname "*format*currency*" -o -iname "*currency*format*" 2>/dev/null | grep -v node_modules | grep "\.ts" | head -1) 2>/dev/null

echo ""
echo "--- ZERO-TOLERANCE CHECKS (all must be 0) ---"

echo "Green accent buttons:"
grep -rn "bg-green-500\|bg-green-600\|#22C55E\|#16A34A" --include="*.tsx" --include="*.css" . 2>/dev/null | grep -v node_modules | grep -v .next | wc -l

echo "Back to dashboard:"
grep -rn "Back to dashboard\|Open dashboard\|Go to dashboard" --include="*.tsx" . 2>/dev/null | grep -v node_modules | wc -l

echo "Native select in pages:"
grep -rn "<select" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v "components/ui" | wc -l

echo "No department text:"
grep -rn '"No department"' --include="*.tsx" . 2>/dev/null | grep -v node_modules | wc -l

echo "Raw DB errors:"
grep -rn "does not exist\|violates constraint" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v ".test.\|sanitize\|isSchema\|isDbError\|isRaw\|technical" | wc -l

echo "Em dashes in user text:"
grep -rn "—" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v ".test.\|format-currency\|CURRENCY_CONFIG\|sanitize" | wc -l

echo "Hardcoded colour classes on buttons:"
grep -rn "bg-orange-\|bg-amber-\|bg-green-\|bg-emerald-" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui\|chart\|Chart\|recharts\|StatusChip\|status-chip" | wc -l

echo "Multiple CTAs per page file:"
grep -rn 'variant.*["\x27]cta["\x27]' --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | awk -F: '{print $1}' | sort | uniq -c | awk '$1 > 1' | wc -l

echo ""
echo "--- USAGE COUNTS (all should be healthy) ---"

echo "EmptyState usage across pages:"
grep -rn "EmptyState" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v "components/ui" | wc -l

echo "ErrorState usage across pages:"
grep -rn "ErrorState" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v "components/ui" | wc -l

echo "formatCurrency usage across pages:"
grep -rn "formatCurrency" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v "lib/\|utils/\|components/ui" | wc -l

echo ""
echo "--- BUILD ---"
npm run build 2>&1 | tail -5

echo ""
echo "============================================"
echo "  EXPECTED: All zero-tolerance checks = 0"
echo "  EXPECTED: All usage counts > 0"
echo "  EXPECTED: Build succeeds"
echo "============================================"
```

If ANY zero-tolerance check is not 0, fix it now. If any usage count is 0, something was missed. If the build fails, fix it. Do not finish until all checks pass.
