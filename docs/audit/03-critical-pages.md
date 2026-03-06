Read `docs/brand/crew-hub-brand-guidelines.html` first. Entire file.

Your task: fix the 5 most broken pages. Only these 5. Do not touch other pages.

RULES:
- Read every file before editing.
- Run `npm run build` after each page fix. Do not move to the next page until the build passes.
- Use the EmptyState, ErrorState, StatusChip, and currency formatting components created in Phase 2. Import them; do not recreate them inline.
- Every button label must start with a verb. Every page has at most ONE button using the `cta` variant (Orange). All other buttons use `default` (Black) or `ghost` (outline).
- No em dashes in any user-facing string.
- Use "crew" not "employees". Use "ops" not "HR". Sentence case for all UI text.

STEP 1: FIND ALL FILES

```bash
# Login
find . -path "*login*" -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null
find . -path "*auth*" -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | head -10

# Performance
find . -path "*performance*" -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null

# Compensation bands
find . -path "*compensation*band*" -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null
find . -path "*compensation*" -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | head -10

# People
find . -path "*people*" -name "page.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null

# Notifications
find . -path "*notification*" -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null

# Logo assets
find . -path "*/public/*" \( -iname "*accrue*" -o -iname "*logo*" -o -iname "*brand*" \) 2>/dev/null

# Shared layout (for sidebar reference)
find . -name "layout.tsx" -path "*/app/*" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null
```

Read EVERY file found before making any changes.

STEP 2: LOGIN PAGE

Find and read the login page component. Then apply ALL of these changes:

1. Page background: Cream (should inherit from --background which is now #FFFAF3). If the login page has its own background class that overrides this (like `bg-slate-900` or `bg-gray-950` or `bg-black`), remove the override so the global Cream background shows through. If the login uses a separate layout that sets a dark background, update that layout.

2. Card container: `bg-card` (White), `border border-border` (warm #E8DFD0), `rounded-xl` (12px), `p-8` (32px padding), `max-w-sm w-full mx-auto`. Centered vertically: the page should use `min-h-screen flex items-center justify-center`.

3. Logo area at top of card: Check if an Accrue logo SVG exists in `/public/`. If it does, render it with appropriate width (~120px) and add "Crew Hub" below in `text-crew-gray1 text-[15px] font-medium`. If no SVG exists, render: `<h1 className="font-serif text-[28px] font-bold text-foreground">Accrue</h1>` and below: `<p className="text-crew-gray1 text-[15px] font-medium">Crew Hub</p>`. Gap between logo and subtitle: 4px. Gap between logo area and first input: 32px.

4. Labels: `text-[13px] font-semibold text-crew-gray1 mb-1.5` (DM Sans, above each field).

5. Inputs: should inherit the updated Input component styling (warm border, orange focus ring). Verify they do.

6. "Sign in" button: `variant="cta"` (Orange). Full width: `w-full`. This is the one CTA on the page.

7. "Forgot password?" link: `text-[13px] text-crew-gray1 hover:text-crew-orange text-center mt-4`. No underline by default, underline on hover.

8. Remove any floating widgets, debug elements, or third-party overlays (like the "N" circle seen in screenshots). Search for Notion, Intercom, HotJar, or similar scripts if the element is not in this component.

9. No "Sign in to continue to your workspace." subtitle unless it is genuinely useful. If it exists, simplify to just the logo + "Crew Hub" label. The page's purpose is self-evident.

STEP 3: PERFORMANCE AND PERFORMANCE ADMIN

Both show: "column review_assignments.shared_at does not exist"

1. Find the data query:
```bash
grep -rn "shared_at" --include="*.tsx" --include="*.ts" --include="*.sql" . 2>/dev/null | grep -v node_modules | grep -v .next
grep -rn "review_assignments" --include="*.tsx" --include="*.ts" --include="*.sql" . 2>/dev/null | grep -v node_modules | grep -v .next
```

2. Read the query. Determine if `shared_at` is essential to the feature or if it can be removed from the SELECT.

3. If it can be removed: remove it from the query. If it is essential: create a Supabase migration file at `supabase/migrations/[timestamp]_add_shared_at_to_review_assignments.sql`:
```sql
ALTER TABLE review_assignments ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;
```
Note: this migration needs to be run manually against the database. Add a comment at the top of the file: `-- RUN THIS MIGRATION: supabase db push or apply manually`

4. Regardless of the query fix: update BOTH the Performance and Performance Admin page components to use the ErrorState component for error display. Replace any raw error rendering (like `{error.message}` or `{error}` displayed in JSX) with:
```tsx
<ErrorState
  error={error}
  onRetry={refetch}  // or whatever the retry mechanism is
/>
```
The ErrorState component already sanitizes DB errors, so even if the migration hasn't been run, the crew will see "Something went wrong" instead of SQL.

5. When both pages load successfully but have no data, they should show EmptyState:
   - Employee performance page: icon `ClipboardCheck`, heading "No review cycles yet", body "Performance reviews will appear here once ops creates a review cycle."
   - Performance admin page: icon `ClipboardCheck`, heading "No review cycles created", body "Create a review cycle to start collecting feedback from the crew." CTA (if there should be one): "Create review cycle" using `variant="cta"`.

STEP 4: COMPENSATION BANDS

Read the entire component. This page has the highest density of issues.

Changes (do ALL of them):

1. Top action buttons: Find the row of buttons. There should be 3: "New band", "Add benchmark", "Assign employee".
   - "New band" = `variant="cta"` (Orange). This is the page's ONE CTA.
   - "Add benchmark" = `variant="ghost"`
   - "Assign employee" = `variant="ghost"`

2. Coverage summary section: Keep as-is. The "Healthy" green bar: verify the green is Sage #2D6A4F. If it uses a different green (like #22C55E), change it.

3. Out-of-band alerts section: "No alerts" card is fine. "Review bands" button: `variant="ghost"`.

4. Compensation bands section: find the empty state. It currently uses a red/brown/destructive background with a nested card. Replace the ENTIRE thing with:
```tsx
<EmptyState
  icon={Layers}
  heading="No compensation bands yet"
  body="Create your first one to start benchmarking and pay equity reviews."
/>
```
Below the EmptyState, the "Create band" button: `variant="default"` (Black primary, since the CTA is already "New band" at the top).

5. Market benchmark data section: replace the red card with:
```tsx
<EmptyState
  icon={TrendingUp}
  heading="No benchmark data imported"
  body="Add external benchmark records to compare your bands with market pay data."
/>
```
"Add benchmark" button below: `variant="default"` (Black).

6. Band assignments section: replace the red card with:
```tsx
<EmptyState
  icon={UserPlus}
  heading="No crew members assigned to bands"
  body="Assign someone to enable compa-ratio and out-of-band checks."
/>
```
"Assign employee" button below: `variant="default"` (Black).

7. Remove ALL "Back to dashboard" buttons. Search within this file: every instance must go. The empty state + action button pattern replaces them.

8. Check for any remaining destructive/red backgrounds used as empty states in this component. There should be zero after the changes above.

STEP 5: PEOPLE PAGE

1. Replace error display with ErrorState component. The current text "People data is unavailable / Unable to load people records." should be handled by ErrorState's default message.

2. "Add person" button: `variant="cta"` (Orange). ONE CTA per page.

3. "Bulk Upload" button: `variant="ghost"`.

4. When data loads but the array is empty, show:
```tsx
<EmptyState
  icon={Users}
  heading="No crew members yet"
  body="Add your first crew member to get started."
/>
```

STEP 6: NOTIFICATIONS

1. Replace error display with ErrorState. Default message is fine.

2. When notifications load but array is empty:
```tsx
<EmptyState
  icon={Bell}
  heading="All caught up"
  body="New notifications will appear here as they come in."
/>
```

STEP 7: VERIFY

```bash
echo "=== Login: no dark bg overrides ==="
grep -n "bg-slate\|bg-gray-9\|bg-black\|bg-zinc\|bg-neutral-9\|bg-\[#1" $(find . -path "*login*page*" -name "*.tsx" 2>/dev/null | head -1) 2>/dev/null

echo "=== Login: uses CTA variant ==="
grep -n "cta\|CTA" $(find . -path "*login*page*" -name "*.tsx" 2>/dev/null | head -1) 2>/dev/null

echo "=== Performance: no raw error display ==="
grep -n "error\.message\|error\.toString\|{error}" $(find . -path "*performance*page*" -name "*.tsx" 2>/dev/null) 2>/dev/null | grep -v "ErrorState\|console\|catch"

echo "=== Performance: uses ErrorState ==="
grep -n "ErrorState\|error-state" $(find . -path "*performance*page*" -name "*.tsx" 2>/dev/null) 2>/dev/null

echo "=== Comp bands: no Back to dashboard ==="
grep -n "Back to dashboard\|Open dashboard" $(find . -path "*compensation*band*" -name "*.tsx" 2>/dev/null | head -1) 2>/dev/null

echo "=== Comp bands: uses EmptyState ==="
grep -c "EmptyState" $(find . -path "*compensation*band*" -name "*.tsx" 2>/dev/null | head -1) 2>/dev/null

echo "=== People: uses ErrorState + EmptyState ==="
grep -n "ErrorState\|EmptyState" $(find . -path "*people*page*" -name "*.tsx" 2>/dev/null | head -1) 2>/dev/null

echo "=== Build ==="
npm run build 2>&1 | tail -5
```

All grep checks for bad patterns should return 0 or empty. All grep checks for good patterns should return 1+. Build must pass.
