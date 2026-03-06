import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { MyDocumentsClient } from "./my-documents-client";

export default async function MyDocumentsPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
      />
    );
  }

  const isSuperAdmin = session.profile.roles.includes("SUPER_ADMIN");

  return (
    <MyDocumentsClient
      currentUserId={session.profile.id}
      isSuperAdmin={isSuperAdmin}
    />
  );
}
