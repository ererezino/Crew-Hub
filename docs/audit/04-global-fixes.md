Read `docs/brand/crew-hub-brand-guidelines.html` first. Entire file.

Your task: fix 7 systemic issues across the entire codebase. Work through each completely before starting the next. Run `npm run build` after each fix to catch regressions.

FIX 1: CURRENCY FORMATTING

The app displays "NGN 0.00" and "NGN 10,001.00" on many pages. The issue is that amounts are shown with the three-letter code ("NGN") instead of the proper currency symbol ("₦"). Every currency must display with its correct symbol.

Step 1: Find all currency display points:
```bash
grep -rn 'NGN \|NGN\.\|"NGN"\|USD \|"USD"\|GHS \|"GHS"\|KES \|"KES"\|ZAR \|"ZAR"\|CAD ' --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next
grep -rn "₦\|\\$.*toFixed\|toFixed(2)\|formatCurrency\|formatMoney\|formatAmount" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next
grep -rn "Intl.NumberFormat\|toLocaleString.*currency\|currency.*format" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next
```

Step 2: Read every file matched. Understand how each one formats currency.

Step 3: The `formatCurrency` utility was created in Phase 2. Find it:
```bash
find . -iname "*format*currency*" -o -iname "*currency*" 2>/dev/null | grep -v node_modules | grep "\.ts"
```

Step 4: Replace EVERY instance of inline currency formatting with the `formatCurrency` utility. Common patterns to find and replace:

Pattern A: String concatenation
```tsx
// BEFORE
`NGN ${amount.toFixed(2)}`
`NGN ${amount}`
"NGN " + amount
// AFTER
formatCurrency(amount, 'NGN')  // renders "₦150,000.00"
```

Pattern B: Template literal with hardcoded symbol
```tsx
// BEFORE
`$${amount.toFixed(2)}`
// AFTER
formatCurrency(amount, 'USD')  // renders "$1,500.00"
```

Pattern C: Intl.NumberFormat inline
```tsx
// BEFORE
new Intl.NumberFormat('en-US', { style: 'currency', currency: 'NGN' }).format(amount)
// AFTER
formatCurrency(amount, 'NGN')
```

Pattern D: Using the three-letter code as prefix
```tsx
// BEFORE
<span>{currency} {amount.toLocaleString()}</span>
// AFTER
<span>{formatCurrency(amount, currency)}</span>
```

Step 5: Check if the currency code comes from a per-employee or per-org setting. If each employee or payroll run has its own currency field, use that field dynamically:
```tsx
formatCurrency(amount, employee.currency || org.defaultCurrency || 'USD')
```

Do NOT hardcode 'USD' everywhere. Use the correct currency for each context. Nigerian employees should see ₦, Ghanaian crew should see GH₵, US crew should see $, etc. The currency is likely stored on the employee record, payroll run, or expense.

Step 6: Verify the specific outputs:
- Naira: `formatCurrency(150000, 'NGN')` must produce "₦150,000.00"
- Dollar: `formatCurrency(1500, 'USD')` must produce "$1,500.00"
- Cedi: `formatCurrency(1500, 'GHS')` must produce "GH₵1,500.00"
- Shilling: `formatCurrency(1500, 'KES')` must produce "KSh1,500.00"
- Rand: `formatCurrency(1500, 'ZAR')` must produce "R1,500.00"
- Canadian Dollar: `formatCurrency(1500, 'CAD')` must produce "CA$1,500.00"
- Zero: `formatCurrency(0, 'USD')` must produce "$0.00"
- Null/undefined: `formatCurrency(null, 'USD')` must produce "—" (em dash or dash)

Write a quick test in the terminal:
```bash
node -e "
const CURRENCY_CONFIG = {
  NGN: { symbol: '₦', locale: 'en-NG' },
  USD: { symbol: '\$', locale: 'en-US' },
  GHS: { symbol: 'GH₵', locale: 'en-GH' },
  KES: { symbol: 'KSh', locale: 'en-KE' },
  ZAR: { symbol: 'R', locale: 'en-ZA' },
  CAD: { symbol: 'CA\$', locale: 'en-CA' },
};
Object.entries(CURRENCY_CONFIG).forEach(([code, cfg]) => {
  const formatted = cfg.symbol + new Intl.NumberFormat(cfg.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1500);
  console.log(code + ': ' + formatted);
});
"
```

Affected pages (non-exhaustive, find all via grep): Payroll dashboard, Payroll runs, Expenses, Expense Reports, Expense Approvals, Analytics (payroll section, expense section), Pay > Payslips metric cards.

FIX 2: REMOVE "BACK TO DASHBOARD" / "OPEN DASHBOARD"

```bash
grep -rn "Back to dashboard\|Open dashboard\|Go to dashboard\|Open Hours\|Back to payroll\|Back to survey\|Back to performance\|Go to dashboard" --include="*.tsx" --include="*.jsx" . 2>/dev/null | grep -v node_modules
```

For EVERY result: read the file, understand the context, then either remove the button entirely or replace it with a contextually relevant action.

Replacements:
| Current text | Replacement |
|-------------|------------|
| "Back to dashboard" (anywhere) | Remove. The empty state copy should be self-sufficient. |
| "Open dashboard" (anywhere) | Remove. |
| "Go to dashboard" | Remove. |
| "Back to payroll" | Remove or "Configure rules" (Ghost) |
| "Back to survey admin" | "Survey admin" with ChevronLeft icon (Ghost) |
| "Back to performance" | "Performance" with ChevronLeft icon (Ghost) |
| "Open Hours" | "Create time policy" (Ghost) |

After all removals:
```bash
grep -rn "Back to dashboard\|Open dashboard\|Go to dashboard" --include="*.tsx" . | grep -v node_modules
# Must return 0 results
```

FIX 3: SIDEBAR ICONS

```bash
grep -rl "sidebar\|Sidebar\|navItems\|NavItem\|SidebarItem\|SidebarNav\|navigation" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next | head -10
```

Read the sidebar config. Find nav items with missing icons (they render as dots). Assign Lucide icons:

| Module | Icon |
|--------|------|
| Dashboard | LayoutDashboard |
| Announcements | Megaphone |
| Time Off | CalendarDays |
| Documents | FileText |
| Learning | GraduationCap |
| Approvals | CheckCircle2 |
| People | Users |
| Scheduling | CalendarClock |
| Onboarding | Rocket |
| Expenses | Receipt |
| Payroll | Banknote |
| Compensation | Coins |
| Compliance | ShieldCheck |
| Performance | Target |
| Analytics | BarChart3 |
| Settings | Settings |
| Signatures | PenLine |
| Surveys | FileQuestion |
| Team Hub | Users2 |

Also: verify the sidebar background uses Crew Navy #1A2B3C. If it uses a different dark colour, update it.

FIX 4: "NO DEPARTMENT" TEXT

```bash
grep -rn '"No department"\|No department\|"no department"' --include="*.tsx" --include="*.jsx" . 2>/dev/null | grep -v node_modules
```

For every match:
- Table cells: show empty string `""` or just don't render the department line
- Chart labels: show "Unassigned"
- Fallback values: change `employee.department || "No department"` to `employee.department || ""` in tables, `employee.department || "Unassigned"` in charts

FIX 5: NATIVE <select> REPLACEMENT

```bash
grep -rn "<select" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v "components/ui"
```

For EVERY native `<select>` in a page component:

1. Read the current select: what options, what value/onChange, what state.
2. Replace with shadcn Select:
```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

<Select value={value} onValueChange={handler}>
  <SelectTrigger className="w-[200px]">
    <SelectValue placeholder="Choose..." />
  </SelectTrigger>
  <SelectContent>
    {options.map(opt => (
      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
    ))}
  </SelectContent>
</Select>
```
3. For employee selectors that need search: use Combobox pattern (Popover + Command).
4. For native date inputs (`<input type="date">`): also replace if a DatePicker exists. Check: `find . -path "*/components/ui/calendar*" -o -path "*/components/ui/date*" 2>/dev/null | grep -v node_modules`. If a calendar component exists, build a DatePicker popover. If not, install: `npx shadcn@latest add calendar popover` then build the DatePicker.

Known locations: year selector (Pay Payslips), employee selector (Compensation Admin), survey form selects (type, status, recurrence, question type), expense approval filters (category), payment details (payment method), analytics filters (country, department), expense report filters (country, department, status, category), compliance date range, payroll run dates.

FIX 6: EM DASHES

```bash
grep -rn "—\|–" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v ".test."
```

Brand rule: "No em dashes anywhere in the output."

For each match in user-facing strings: replace with a period, comma, or restructured sentence. Do NOT change em dashes that appear in code logic, comments, or non-rendered strings. Only user-facing JSX text.

Note: the `formatCurrency` function uses "—" for null values. This is a display dash, not an em dash used in prose. That is acceptable. But if you prefer consistency, you can use "-" or "–" instead.

FIX 7: VOICE QUICK FIXES

While you're in every file, also fix these if you spot them:
- "employees" or "staff" -> "crew" or "crew members"
- "HR department" -> "ops"
- "PTO" -> "leave"
- "Submit" (as a button label) -> specific verb: "Send request", "Save changes"
- "line manager" -> "manager"
- Title Case in descriptions -> sentence case
- Trailing periods in page descriptions -> remove

Do NOT do a comprehensive voice audit here. That is Phase 7. Just fix obvious ones as you encounter them.

VERIFY ALL:

```bash
echo "=== NGN as string prefix (expect 0) ==="
grep -rn '"NGN \|"NGN"\|`NGN ' --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v "format-currency\|CURRENCY_CONFIG\|currency.*config" | wc -l

echo "=== Back to dashboard (expect 0) ==="
grep -rn "Back to dashboard\|Open dashboard\|Go to dashboard" --include="*.tsx" . | grep -v node_modules | wc -l

echo "=== No department (expect 0) ==="
grep -rn '"No department"' --include="*.tsx" . | grep -v node_modules | wc -l

echo "=== Native select in pages (expect 0) ==="
grep -rn "<select" --include="*.tsx" . | grep -v node_modules | grep -v "components/ui" | wc -l

echo "=== Em dashes in user strings (expect 0 or near 0) ==="
grep -rn "—" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v ".test.\|format-currency\|CURRENCY" | wc -l

echo "=== formatCurrency imported across pages ==="
grep -rn "formatCurrency" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v "components/ui\|lib/\|utils/" | wc -l

echo "=== Build ==="
npm run build 2>&1 | tail -5
```
