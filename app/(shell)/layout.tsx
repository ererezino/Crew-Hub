import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "../../components/shared/app-shell";
import { getAuthenticatedSession } from "../../lib/auth/session";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await getAuthenticatedSession();

  if (!session) {
    redirect("/login");
  }

  if (session.sessionStatus === "inactive") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login?error=account_disabled");
  }

  if (session.sessionStatus === "mfa_setup_required") {
    redirect("/mfa-setup");
  }

  if (session.sessionStatus === "mfa_required") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <AppShell
      currentUserRoles={session.profile?.roles ?? []}
      currentUserProfile={
        session.profile
          ? {
              fullName: session.profile.full_name,
              email: session.profile.email,
              avatarUrl: session.profile.avatar_url
            }
          : null
      }
      profileLocale={session.profile?.preferred_locale}
    >
      {children}
    </AppShell>
  );
}
