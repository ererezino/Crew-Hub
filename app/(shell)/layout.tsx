import type { ReactNode } from "react";

import { AppShell } from "../../components/shared/app-shell";
import { getAuthenticatedSession } from "../../lib/auth/session";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await getAuthenticatedSession();

  return (
    <AppShell currentUserRoles={session?.profile?.roles ?? []}>{children}</AppShell>
  );
}
