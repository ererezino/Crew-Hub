# Passkey Rollout — Dormant Scaffolding

**Status:** Complete, dormant, blocked on Supabase hosted WebAuthn support
**Decision date:** 2026-03-16
**Decision:** Wait for Supabase hosted WebAuthn. Do not switch auth providers.

## Why this is dormant

Supabase hosted GoTrue rejects WebAuthn enablement (HTTP 422: "Enabling of MFA
with WebAuthn not currently supported"). The SDK methods exist
(`mfa.webauthn.register`, `.authenticate`), the config schema exists
(`[auth.mfa.web_authn]`), but the hosted service has not flipped the switch.

Crew Hub's auth is deeply integrated with Supabase (system-derived passwords,
AAL2 enforcement, RLS, admin revocation, middleware). Switching or splitting
auth providers would be a multi-month rewrite for a UX convenience feature.
TOTP-based MFA is already strong.

## Activation trigger

Supabase enables hosted WebAuthn MFA, confirmed by:

1. `supabase config push` with `[auth.mfa.web_authn] enroll_enabled = true`
   returns HTTP 200 (not 422)
2. A WebAuthn factor can be successfully enrolled via the SDK

## Activation checklist

Located inline below. Also referenced in the project decision memo from
2026-03-16.

### 1. Enable WebAuthn in Supabase

```bash
# Uncomment in supabase/config.toml:
[auth.mfa.web_authn]
enroll_enabled = true
verify_enabled = true

# Push to staging first:
supabase config push --project-ref rvcpvfmkjadbkvhmiklu

# Verify:
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.supabase.com/v1/projects/rvcpvfmkjadbkvhmiklu/config/auth \
  | jq '.mfa_web_authn_enroll_enabled'
# Expected: true
```

### 2. Flip feature flag

```typescript
// lib/feature-state.ts — change:
passkeys: "LIVE"   // was: "COMING_SOON"
```

### 3. Deploy to staging and verify

- [ ] MFA setup: TOTP done → passkey prompt → Add a Passkey → WebAuthn dialog
- [ ] Settings → Security: passkey section visible, add button works
- [ ] Dashboard: nudge banner appears for users with TOTP but no passkey
- [ ] Login: passkey-first button appears for users with enrolled passkey
- [ ] Error paths: cancel WebAuthn → graceful fallback to TOTP
- [ ] 1Password: passkey saves correctly, autofill works

### 4. Push to production

```bash
supabase config push --project-ref xmeruhyybvyosqfleiu
```

Deploy with `passkeys: "LIVE"`. Monitor 24h.

## What was built

| Surface | File(s) | Behavior when dormant |
|---|---|---|
| Feature flag | `lib/feature-state.ts` | `passkeys: "COMING_SOON"` |
| MFA setup flow | `app/mfa-setup/page.tsx` | 3-step only (no passkey steps) |
| Login page | `app/login/page.tsx` | Standard email → OTP, no passkey button |
| Settings security | `app/(shell)/settings/settings-client.tsx` | No passkey section |
| Dashboard nudge | `components/dashboard/passkey-nudge-banner.tsx` | Returns null immediately |
| MFA API | `app/api/v1/me/mfa/route.ts` | Returns `passkeyCount: 0` (harmless) |
| i18n | `messages/en.json`, `messages/fr.json` | Keys present, unused |

## When to revisit

- Supabase explicitly announces no hosted WebAuthn in 2026
- Critical security incident requires phishing-resistant auth immediately
- If revisiting, evaluate self-hosting GoTrue before switching providers
