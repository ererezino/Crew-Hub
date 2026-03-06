Read `docs/brand/crew-hub-brand-guidelines.html` first. Entire file. It is the source of truth.

Your task: create or update core UI components to match the brand. Do not touch page-level components. Only `components/ui/` or equivalent shared component directory.

RULES:
- Read every file before editing it.
- Do not guess component prop names. Read the existing components and match their conventions.
- Run `npm run build` after each component change. Fix errors before moving to the next component.
- If a component already exists and is close to correct, update it. Do not delete and recreate.

STEP 1: DISCOVERY

```bash
# List all UI components
ls -la $(find . -path "*/components/ui" -type d -not -path "*/node_modules/*" 2>/dev/null | head -1)/

# Read the Button component
cat $(find . -path "*/components/ui/button*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Read the Badge component
cat $(find . -path "*/components/ui/badge*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Read the Card component
cat $(find . -path "*/components/ui/card*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Read the Input component
cat $(find . -path "*/components/ui/input*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Read Select component (if exists)
cat $(find . -path "*/components/ui/select*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Check existing empty/error state components
find . \( -iname "*empty*" -o -iname "*error-state*" -o -iname "*error-card*" -o -iname "*status*badge*" -o -iname "*status*chip*" \) -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null
# Read each one found

# Check what Select/Combobox components exist
find . -path "*/components/ui/*" -name "*.tsx" -not -path "*/node_modules/*" 2>/dev/null | sort

# Check for existing currency formatting
grep -rn "formatCurrency\|formatMoney\|formatAmount\|Intl.NumberFormat\|toLocaleString.*currency\|currency.*format" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next

# Check how the project patterns component exports
head -5 $(find . -path "*/components/ui/button*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -1)
```

STEP 2: BUTTON COMPONENT

Read the current Button component. Understand its variant system (does it use `cva`? class-variance-authority? plain objects?). Then update or add these variants, matching the existing pattern:

| Variant name | Background | Text | Border | Notes |
|-------------|-----------|------|--------|-------|
| `default` | Black #000000 | White | none | Primary action per section. Can appear multiple times. |
| `cta` | Orange #FD8B05 | White | none | ONE per page max. Add this variant if it does not exist. |
| `ghost` or `outline` | transparent | Black | 1px solid black | Secondary/tertiary actions. |
| `destructive` | Red tint (light red bg) | #C0392B | none | Irreversible actions only. |
| `link` | transparent | Black or Orange | none | Text-only, underline on hover. Keep if it exists. |

All variants:
- Border radius: `rounded-full` (pill, 9999px). If the current buttons use `rounded-md` or `rounded-lg`, change to `rounded-full`.
- Height: `h-9` (36px)
- Font: DM Sans (inherits from body font-sans). Never serif.
- Padding: `px-5` for standard, `px-3` for `size="sm"`, `px-8` for `size="lg"`
- Font size: 14px (text-sm) weight 500
- Transition: `transition-colors duration-150`

Disabled state (applies to all variants):
- Background: #F0EBE1 (Dust)
- Text: #727272 (Gray 2)
- `pointer-events-none opacity-100` (not opacity-50, the dust bg already communicates disabled)

Do not change the component's TypeScript interface/props. Only update the style mappings.

STEP 3: EMPTY STATE COMPONENT

Find existing empty state component. If none exists, create `components/ui/empty-state.tsx`.

Read any page that currently renders an empty state to understand the existing pattern. Then create or update:

```tsx
// Props interface (adapt naming to project conventions):
interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;  // Lucide icon component
  heading: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  className?: string;
}
```

Render structure:
- Outer: `flex flex-col items-center justify-center text-center py-16 px-6`
- Icon: `className="h-12 w-12 text-crew-gray2 mb-4"` (48px, #727272)
- Heading: `className="text-[17px] font-semibold text-foreground mb-1.5"` (DM Sans, not serif)
- Body: `className="text-[15px] text-crew-gray1 max-w-[400px] leading-[1.65] mb-6"` (#495057)
- Action button: Ghost variant, only if actionLabel is provided

This component does NOT have a card wrapper by default. The parent page decides whether to wrap it in a Card. This makes it flexible for both card and full-page empty states.

NEVER use destructive/red/error colours in this component. If you find existing empty states using red backgrounds, that is wrong and will be fixed in Phase 5.

STEP 4: ERROR STATE COMPONENT

Create or update `components/ui/error-state.tsx`.

```tsx
interface ErrorStateProps {
  heading?: string;      // Default: "Something went wrong"
  body?: string;         // Default: "Try again in a moment. If it keeps happening, reach out to ops."
  onRetry?: () => void;
  error?: Error | string | null;  // Raw error. WILL BE SANITIZED.
  className?: string;
}
```

Error sanitization logic (MUST be in this component):
```tsx
function sanitizeError(error: Error | string | null | undefined): string | null {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  // Never show raw database, SQL, or technical errors to the crew
  const technicalPatterns = [
    /column.*does not exist/i,
    /relation.*does not exist/i,
    /violates.*constraint/i,
    /SQLSTATE/i,
    /pg_/i,
    /supabase/i,
    /TypeError/i,
    /undefined is not/i,
    /Cannot read propert/i,
    /fetch failed/i,
    /NetworkError/i,
    /ECONNREFUSED/i,
    /500\b/i,
    /502\b/i,
    /503\b/i,
    /504\b/i,
  ];
  for (const pattern of technicalPatterns) {
    if (pattern.test(msg)) return null; // Return null to use default message
  }
  return msg;
}
```

Render structure:
- Outer: `rounded-xl border border-destructive/20 bg-destructive/5 p-6` (subtle red tint, not heavy dark red)
- Icon: AlertTriangle from lucide-react, `className="h-10 w-10 text-crew-danger mb-3"` (#C0392B)
- Heading: `className="text-[17px] font-semibold text-crew-danger mb-1"` (#C0392B)
- Body: `className="text-[15px] text-crew-gray1 mb-4"` (#495057)
- Retry button: Ghost variant, label "Try again"
- Helper: `className="text-[13px] text-crew-gray2 mt-3"` showing "If it keeps happening, reach out to ops."

If the sanitized error is null (technical error detected), use the default heading and body. Never show the raw error text.

STEP 5: STATUS CHIP COMPONENT

Create `components/ui/status-chip.tsx` or update existing badge component.

```tsx
type StatusVariant = 'approved' | 'pending' | 'declined' | 'draft' | 'archived';

interface StatusChipProps {
  status: StatusVariant;
  label?: string;  // Override display text. Default: capitalize the status.
  className?: string;
}
```

Colour mapping:

| status | Text | Background | Default label |
|--------|------|-----------|---------------|
| approved | #2D6A4F (Sage) | #E8F5EE | Approved |
| pending | #D97706 (Amber) | #FEF3C7 | Pending |
| declined | #C0392B (Red) | #FEE2E2 | Declined |
| draft | #1A2B3C (Navy) | #E8EDF2 | Draft |
| archived | #727272 (Gray 2) | #F0EBE1 (Dust) | Archived |

Style: `inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em]`

STEP 6: CURRENCY FORMATTING UTILITY

This is critical. Find any existing currency formatting code. Then create or update a utility that handles ALL currencies correctly with their proper symbols.

Create `lib/format-currency.ts` or `utils/format-currency.ts` (match project conventions):

```tsx
const CURRENCY_CONFIG: Record<string, { symbol: string; code: string; locale: string; decimals: number }> = {
  NGN: { symbol: '₦', code: 'NGN', locale: 'en-NG', decimals: 2 },
  USD: { symbol: '$', code: 'USD', locale: 'en-US', decimals: 2 },
  GHS: { symbol: 'GH₵', code: 'GHS', locale: 'en-GH', decimals: 2 },
  KES: { symbol: 'KSh', code: 'KES', locale: 'en-KE', decimals: 2 },
  ZAR: { symbol: 'R', code: 'ZAR', locale: 'en-ZA', decimals: 2 },
  CAD: { symbol: 'CA$', code: 'CAD', locale: 'en-CA', decimals: 2 },
  GBP: { symbol: '£', code: 'GBP', locale: 'en-GB', decimals: 2 },
  EUR: { symbol: '€', code: 'EUR', locale: 'en-IE', decimals: 2 },
};

/**
 * Format a monetary amount with the correct currency symbol and locale.
 *
 * Examples:
 *   formatCurrency(150000, 'NGN')  -> "₦150,000.00"
 *   formatCurrency(1500, 'USD')    -> "$1,500.00"
 *   formatCurrency(1500, 'GHS')    -> "GH₵1,500.00"
 *   formatCurrency(1500, 'KES')    -> "KSh1,500.00"
 *   formatCurrency(1500, 'ZAR')    -> "R1,500.00"
 *   formatCurrency(1500, 'CAD')    -> "CA$1,500.00"
 *   formatCurrency(0, 'USD')       -> "$0.00"
 */
export function formatCurrency(
  amount: number | null | undefined,
  currencyCode: string = 'USD'
): string {
  if (amount === null || amount === undefined) return '—';

  const config = CURRENCY_CONFIG[currencyCode.toUpperCase()];

  if (!config) {
    // Fallback: use Intl with the code
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currencyCode} ${amount.toFixed(2)}`;
    }
  }

  // Format the number with proper grouping
  const formatted = new Intl.NumberFormat(config.locale, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  }).format(amount);

  return `${config.symbol}${formatted}`;
}

/**
 * Get just the symbol for a currency code.
 *   getCurrencySymbol('NGN') -> "₦"
 *   getCurrencySymbol('GHS') -> "GH₵"
 */
export function getCurrencySymbol(currencyCode: string): string {
  return CURRENCY_CONFIG[currencyCode.toUpperCase()]?.symbol ?? currencyCode;
}
```

Find where currency is currently formatted in the codebase:
```bash
grep -rn "NGN \|NGN\.\|\\$.*toFixed\|formatCurrency\|formatMoney\|\.toFixed(2)\|Intl.*NumberFormat.*currency\|toLocaleString.*style.*currency" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next
```

If there is an existing currency formatting function, update it to use the logic above. If currency is formatted inline (string concatenation like `"NGN " + amount` or template literals), those will be fixed in Phase 4 when we go through every page. For now, just make sure the utility exists and is exported.

STEP 7: CARD COMPONENT

Read the Card component. Verify its default styling produces:
- Background: uses `--card` variable (which is now White #FFFFFF)
- Border: uses `--border` variable (which is now warm #E8DFD0)
- Radius: 12px (`rounded-xl`). If it uses `rounded-lg` (8px), change to `rounded-xl`.
- No shadow by default. If there is a `shadow-sm` or similar, remove it.

If the Card component is a shadcn component using CSS variables, the colour changes from Phase 1 should already apply. Just check the radius.

STEP 8: INPUT COMPONENT

Read the Input component. Verify:
- Default border: uses `--input` variable (now warm #E8DFD0)
- Focus ring: uses `--ring` variable (now Orange #FD8B05). Check if focus uses `ring-ring` or `border-ring` or a focus-visible class. Make sure orange shows on focus.
- Height: `h-10` (40px)
- Font: inherits body (DM Sans 15px)
- Radius: `rounded-lg` (8px, compact variant per brand) or `rounded-xl` (12px). Check which the project uses for inputs.

STEP 9: SELECT COMPONENT

Verify shadcn Select exists:
```bash
find . -path "*/components/ui/select*" -not -path "*/node_modules/*" 2>/dev/null
```

If it does not exist, install it:
```bash
npx shadcn@latest add select
```

Also check for Combobox (needed for searchable selects like employee pickers):
```bash
find . -path "*/components/ui/command*" -o -path "*/components/ui/combobox*" 2>/dev/null | grep -v node_modules
```

If Command does not exist:
```bash
npx shadcn@latest add command popover
```

STEP 10: VERIFY

```bash
echo "=== Button has CTA variant ==="
grep -c "cta" $(find . -path "*/components/ui/button*" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "=== Button uses rounded-full ==="
grep -c "rounded-full" $(find . -path "*/components/ui/button*" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "=== EmptyState exists ==="
find . -iname "*empty*state*" -path "*/components/*" -not -path "*/node_modules/*" 2>/dev/null

echo "=== ErrorState exists with sanitization ==="
grep -c "sanitize\|technicalPattern\|SQLSTATE\|does not exist" $(find . -iname "*error*state*" -path "*/components/*" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

echo "=== StatusChip exists ==="
find . \( -iname "*status*chip*" -o -iname "*status*badge*" \) -path "*/components/*" -not -path "*/node_modules/*" 2>/dev/null

echo "=== Currency formatter exists ==="
find . -iname "*format*currency*" -o -iname "*currency*format*" 2>/dev/null | grep -v node_modules

echo "=== Currency formatter handles NGN, USD, GHS, KES, ZAR ==="
grep -c "NGN\|GHS\|KES\|ZAR\|CAD" $(find . -iname "*format*currency*" -o -iname "*currency*" 2>/dev/null | grep -v node_modules | grep "\.ts" | head -1) 2>/dev/null

echo "=== Select component exists ==="
find . -path "*/components/ui/select*" -not -path "*/node_modules/*" 2>/dev/null

echo "=== Build ==="
npm run build 2>&1 | tail -5
```
