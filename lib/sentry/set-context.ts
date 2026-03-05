import * as Sentry from "@sentry/nextjs";

import type { SessionProfile } from "../auth/session";

/**
 * Sets Sentry context with org_id, user_role, and route.
 * Never includes PII (name, email, phone, employee ID, financial data).
 */
export function setSentryContext(
  profile: SessionProfile | null,
  route: string
): void {
  if (!profile) {
    return;
  }

  const highestRole =
    profile.roles.length > 0
      ? profile.roles[0]
      : "EMPLOYEE";

  Sentry.setContext("crew_hub", {
    org_id: profile.org_id,
    user_role: highestRole,
    route
  });

  // Set user with only non-PII identifier
  Sentry.setUser({ id: profile.id });
}
