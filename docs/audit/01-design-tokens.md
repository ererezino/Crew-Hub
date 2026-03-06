Read `docs/brand/crew-hub-brand-guidelines.html` in this repo first. Read the entire file. It is the source of truth for every decision in this task.

Your task: realign the design system foundation to match the brand guidelines. Colours, typography, spacing, dark mode, and theme tokens. Do not touch page components yet. Only the design system layer.

RULES FOR ALL WORK:
- Do not guess file paths, prop names, variable names, or class names. Run `find` or `grep` first. Read the file. Then edit.
- After making changes, run `npm run build`. If it fails, fix it before moving on.
- If the project uses CSS custom properties in HSL format (shadcn pattern), convert hex values to HSL when setting them. If it uses hex, use hex. Match the existing convention.
- Read every file you are about to edit before editing it. Understand its full structure.
- Do not delete dark mode. Fix it to use the brand's dark palette.

STEP 1: FULL DISCOVERY

Run every command below. Read every result. Do not skip any.

```bash
# Project structure
ls -la
cat package.json | head -30

# Framework config
find . -name "next.config*" -not -path "*/node_modules/*" 2>/dev/null
find . -name "tailwind.config*" -type f -not -path "*/node_modules/*" 2>/dev/null

# Read tailwind config
cat $(find . -name "tailwind.config*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Global CSS
find . -name "globals.css" -o -name "global.css" 2>/dev/null | grep -v node_modules
cat $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Current font setup
grep -rn "font-family\|fontFamily\|Geist\|Inter\|Circular\|Playfair\|DM.Sans\|dm-sans\|dmSans" --include="*.tsx" --include="*.ts" --include="*.css" --include="*.mjs" . 2>/dev/null | grep -v node_modules | grep -v .next

# Font files
find . \( -iname "*playfair*" -o -iname "*dm-sans*" -o -iname "*dmsans*" -o -iname "*.woff*" -o -iname "*.ttf" -o -iname "*.otf" \) -not -path "*/node_modules/*" 2>/dev/null

# How fonts are loaded (next/font or CSS import)
grep -rn "next/font\|@import.*font\|@font-face\|google.*font" --include="*.tsx" --include="*.ts" --include="*.css" . 2>/dev/null | grep -v node_modules | grep -v .next

# Current CSS variables (the full theme)
grep -rn "\-\-" --include="*.css" . 2>/dev/null | grep -v node_modules | grep -v .next | head -80

# Current colour usage
grep -rn "FFFAF3\|fffaf3\|FD8B05\|fd8b05\|E8DFD0\|e8dfd0\|1A2B3C\|1a2b3c\|2D6A4F\|2d6a4f\|22C55E\|F59E0B\|EF4444" --include="*.css" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next | head -40

# Layout file (to understand theme provider, body classes)
find . -name "layout.tsx" -path "*/app/*" -not -path "*/node_modules/*" 2>/dev/null
cat $(find . -name "layout.tsx" -path "*/app/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)

# Theme provider
grep -rn "ThemeProvider\|theme-provider\|next-themes\|darkMode" --include="*.tsx" --include="*.ts" --include="*.mjs" . 2>/dev/null | grep -v node_modules | grep -v .next | head -10
```

Stop here. Read everything. Understand:
- What theme system is in use (CSS variables? Tailwind? shadcn? next-themes?)
- What format the variables use (HSL? hex? RGB?)
- What fonts are currently loaded and how
- Whether dark mode is class-based or media-based
- What the current default theme is (light or dark)

STEP 2: COLOUR TOKENS

The brand palette (from the guidelines):

| Name | Hex | HSL (approximate) | Role |
|------|-----|--------------------|------|
| Cream | #FFFAF3 | 37 100% 97% | Default page canvas |
| Orange | #FD8B05 | 34 98% 50% | CTA accent, focus rings |
| Black | #000000 | 0 0% 0% | Headlines, primary buttons, icons |
| Gray 1 | #495057 | 207 7% 31% | Body text, secondary labels |
| Gray 2 | #727272 | 0 0% 45% | Captions, placeholders, disabled |
| White | #FFFFFF | 0 0% 100% | Card bg, reversed type |
| Crew Navy | #1A2B3C | 207 39% 17% | Sidebar, navigation |
| Crew Sage | #2D6A4F | 153 40% 30% | Approval/success states |
| Warm border | #E8DFD0 | 36 30% 86% | Borders, dividers |
| Dust | #F0EBE1 | 36 30% 92% | Disabled surfaces |
| Danger red | #C0392B | 6 63% 46% | Errors, destructive |
| Pending amber | #D97706 | 37 91% 44% | Pending/review status |

Map these to the existing CSS variable structure. Example if the project uses shadcn HSL format:

```css
:root {
  --background: 37 100% 97%;       /* Cream #FFFAF3 */
  --foreground: 0 0% 0%;           /* Black #000000 */
  --card: 0 0% 100%;               /* White #FFFFFF */
  --card-foreground: 0 0% 0%;      /* Black */
  --popover: 0 0% 100%;            /* White */
  --popover-foreground: 0 0% 0%;   /* Black */
  --primary: 0 0% 0%;              /* Black - primary buttons */
  --primary-foreground: 0 0% 100%; /* White */
  --secondary: 36 30% 92%;         /* Dust - secondary bg */
  --secondary-foreground: 0 0% 0%; /* Black */
  --muted: 36 30% 92%;             /* Dust */
  --muted-foreground: 207 7% 31%;  /* Gray 1 */
  --accent: 34 98% 50%;            /* Orange #FD8B05 */
  --accent-foreground: 0 0% 100%;  /* White */
  --destructive: 6 63% 46%;        /* #C0392B */
  --destructive-foreground: 0 0% 100%;
  --border: 36 30% 86%;            /* Warm border #E8DFD0 */
  --input: 36 30% 86%;             /* Warm border */
  --ring: 34 98% 50%;              /* Orange focus ring */
  --radius: 0.75rem;               /* 12px */
}

.dark {
  --background: 207 39% 17%;       /* Crew Navy #1A2B3C */
  --foreground: 210 40% 98%;       /* Near white */
  --card: 210 30% 22%;             /* Slightly lighter navy */
  --card-foreground: 210 40% 98%;
  --popover: 210 30% 22%;
  --popover-foreground: 210 40% 98%;
  --primary: 0 0% 100%;            /* White on dark */
  --primary-foreground: 0 0% 0%;   /* Black */
  --secondary: 210 25% 25%;
  --secondary-foreground: 210 40% 98%;
  --muted: 210 25% 25%;
  --muted-foreground: 215 20% 65%;
  --accent: 34 98% 50%;            /* Orange stays */
  --accent-foreground: 0 0% 100%;
  --destructive: 6 63% 46%;        /* Same red */
  --destructive-foreground: 0 0% 100%;
  --border: 210 25% 30%;
  --input: 210 25% 30%;
  --ring: 34 98% 50%;              /* Orange */
}
```

Adapt this to match the EXACT variable names and format the project already uses. Do not change variable names. Only values.

Also add custom variables for colours the standard shadcn set does not cover:

```css
:root {
  --crew-navy: 207 39% 17%;
  --crew-sage: 153 40% 30%;
  --crew-dust: 36 30% 92%;
  --crew-orange: 34 98% 50%;
  --crew-gray1: 207 7% 31%;
  --crew-gray2: 0 0% 45%;
  --crew-warm-border: 36 30% 86%;
  --crew-pending: 37 91% 44%;
  --crew-danger: 6 63% 46%;
}
```

And extend Tailwind config to expose them:

```js
// In tailwind.config extend.colors:
crew: {
  navy: "hsl(var(--crew-navy))",
  sage: "hsl(var(--crew-sage))",
  dust: "hsl(var(--crew-dust))",
  orange: "hsl(var(--crew-orange))",
  gray1: "hsl(var(--crew-gray1))",
  gray2: "hsl(var(--crew-gray2))",
  pending: "hsl(var(--crew-pending))",
  danger: "hsl(var(--crew-danger))",
}
```

STEP 3: LIGHT MODE DEFAULT

The brand says Cream is the default canvas. Check if the app defaults to dark mode. Look for:
- `<ThemeProvider defaultTheme="dark" ...>` or similar
- `class="dark"` on the `<html>` or `<body>` element
- A cookie or localStorage default

Change the default to light mode:
- `defaultTheme="light"` or `defaultTheme="system"` (system is acceptable if the OS preference fallback works)
- Do NOT remove dark mode entirely. Just change the default.

STEP 4: TYPOGRAPHY

Load Playfair Display (serif) and DM Sans (sans-serif).

Check how the project currently loads fonts. If it uses `next/font/google`:

```tsx
import { Playfair_Display, DM_Sans } from 'next/font/google';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

// In the body/html className:
className={`${playfair.variable} ${dmSans.variable}`}
```

If it uses a different font loading method, adapt accordingly. The key output is two CSS variables: `--font-serif` for Playfair and `--font-sans` for DM Sans.

Update Tailwind config:

```js
fontFamily: {
  sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
  serif: ['var(--font-serif)', 'Georgia', '"Times New Roman"', 'serif'],
  mono: ['"DM Mono"', '"Fira Code"', 'monospace'], // keep existing mono if any
}
```

Remove any references to Geist, Inter, or Circular Std as the primary fonts.

Set body font to sans (DM Sans) by default. This is usually handled by Tailwind's `font-sans` on the body or a base layer.

Type scale: add Tailwind utilities or global CSS classes:

```css
.text-display { font-family: var(--font-serif); font-size: 40px; font-weight: 900; letter-spacing: -0.035em; line-height: 1.1; }
.text-h1 { font-family: var(--font-serif); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
.text-h2 { font-family: var(--font-serif); font-size: 22px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.3; }
.text-h3 { font-family: var(--font-sans); font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.text-body { font-family: var(--font-sans); font-size: 15px; font-weight: 400; line-height: 1.65; }
.text-small { font-family: var(--font-sans); font-size: 13px; font-weight: 400; line-height: 1.5; }
.text-label { font-family: var(--font-sans); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
```

Or define them in the Tailwind config as `fontSize` entries if the project prefers that pattern.

STEP 5: SPACING AND RADIUS

Verify these are set in the Tailwind config or are available as utilities:
- `--radius: 0.75rem` (12px) for standard cards/containers
- Compact radius: 8px (rounded-lg) for inline elements, chips
- Button radius: 9999px (rounded-full) for pill buttons
- Card padding: 24px (p-6)
- Section gap (related items): 16px (gap-4)
- Section gap (unrelated): 48px (gap-12)
- Page horizontal padding: 32px (px-8)

STEP 6: VERIFY

```bash
# Check cream canvas is defined
echo "=== Cream canvas ==="
grep -c "FFFAF3\|fffaf3\|37 100% 97%" $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

# Check warm border
echo "=== Warm border ==="
grep -c "E8DFD0\|e8dfd0\|36 30% 86%" $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

# Check fonts loaded
echo "=== Playfair ==="
grep -rn "Playfair\|playfair" --include="*.tsx" --include="*.ts" --include="*.css" --include="*.mjs" . 2>/dev/null | grep -v node_modules | grep -v .next | wc -l

echo "=== DM Sans ==="
grep -rn "DM.Sans\|dm.sans\|DM_Sans\|dmSans" --include="*.tsx" --include="*.ts" --include="*.css" --include="*.mjs" . 2>/dev/null | grep -v node_modules | grep -v .next | wc -l

# Check dark mode still works
echo "=== Dark mode preserved ==="
grep -c "\.dark" $(find . -name "globals.css" -not -path "*/node_modules/*" 2>/dev/null | head -1) 2>/dev/null

# Check default theme is light
echo "=== Default theme ==="
grep -rn "defaultTheme\|default.*theme\|forcedTheme" --include="*.tsx" --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v .next

# Build
echo "=== Build ==="
npm run build 2>&1 | tail -5
```

All font checks should show 1+. Build must pass. Dark mode .dark block must exist. Default theme must be "light" or "system".
