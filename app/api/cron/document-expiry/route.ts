import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createNotification, createBulkNotifications } from "../../../../lib/notifications/service";
import { sendDocumentExpiryEmail, sendDocumentExpiredEmail } from "../../../../lib/notifications/email";

/**
 * Daily cron endpoint: warns about documents expiring in 30 days.
 *
 * Triggered by Vercel Cron daily at 07:00 UTC.
 * Protected by CRON_SECRET header to prevent unauthorized access.
 *
 * Logic:
 * - Finds documents where expiry_date is exactly 30 days from today
 * - Notifies the document owner (in-app + email)
 * - Also notifies all HR_ADMINs and SUPER_ADMINs in the same org
 */

function thirtyDaysFromNowIso(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + 30);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function yesterdayIso(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expiryDate = thirtyDaysFromNowIso();
  const supabase = createSupabaseServiceRoleClient();

  // Find documents expiring exactly 30 days from now
  const { data: documents, error: docsError } = await supabase
    .from("documents")
    .select("id, org_id, title, owner_user_id, expiry_date")
    .eq("expiry_date", expiryDate)
    .is("deleted_at", null);

  if (docsError) {
    console.error("Failed to fetch expiring documents:", docsError.message);
    return NextResponse.json(
      {
        error: "Failed to fetch expiring documents",
        expiryDate
      },
      { status: 500 }
    );
  }

  let warningsSent = 0;

  // Group documents by org for efficient admin lookup
  const docsByOrg = new Map<string, NonNullable<typeof documents>>();

  for (const doc of documents ?? []) {
    const orgId = typeof doc.org_id === "string" ? doc.org_id : null;
    if (!orgId) continue;

    const existing = docsByOrg.get(orgId) ?? [];
    existing.push(doc);
    docsByOrg.set(orgId, existing);
  }

  for (const [orgId, orgDocs] of docsByOrg) {
    // Find HR_ADMINs and SUPER_ADMINs in this org
    const { data: adminRows, error: adminError } = await supabase
      .from("profiles")
      .select("id, roles")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (adminError) {
      console.error(`Failed to fetch admins for org ${orgId}:`, adminError.message);
      continue;
    }

    const adminIds = (adminRows ?? [])
      .filter((row) => {
        const roles = Array.isArray(row.roles) ? row.roles : [];
        return roles.includes("HR_ADMIN") || roles.includes("SUPER_ADMIN");
      })
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    for (const doc of orgDocs) {
      const docTitle = typeof doc.title === "string" ? doc.title : "Document";
      const docId = typeof doc.id === "string" ? doc.id : null;
      const ownerId = typeof doc.owner_user_id === "string" ? doc.owner_user_id : null;

      if (!docId) continue;

      const messageBody = `${docTitle} expires on ${expiryDate}. Please renew it.`;
      const notificationLink = `/documents/${docId}`;

      // Notify the document owner
      if (ownerId) {
        void createNotification({
          orgId,
          userId: ownerId,
          type: "document_expiry_warning",
          title: "Document expiring soon",
          body: messageBody,
          link: notificationLink
        });

        void sendDocumentExpiryEmail({
          orgId,
          userId: ownerId,
          documentTitle: docTitle,
          expiryDate
        });
      }

      // Notify HR admins and super admins (excluding owner if already notified)
      const adminRecipients = adminIds.filter((adminId) => adminId !== ownerId);

      if (adminRecipients.length > 0) {
        void createBulkNotifications({
          orgId,
          userIds: adminRecipients,
          type: "document_expiry_warning",
          title: "Document expiring soon",
          body: messageBody,
          link: notificationLink
        });

        void Promise.all(
          adminRecipients.map((adminId) =>
            sendDocumentExpiryEmail({
              orgId,
              userId: adminId,
              documentTitle: docTitle,
              expiryDate
            })
          )
        );
      }

      warningsSent++;
    }
  }

  // ─── Already-expired documents (expired yesterday) ───

  const expiredDate = yesterdayIso();
  let expiredNotified = 0;

  const { data: expiredDocs, error: expiredError } = await supabase
    .from("documents")
    .select("id, org_id, title, owner_user_id, expiry_date")
    .eq("expiry_date", expiredDate)
    .is("deleted_at", null);

  if (expiredError) {
    console.error("Failed to fetch expired documents:", expiredError.message);
  } else if (expiredDocs && expiredDocs.length > 0) {
    for (const doc of expiredDocs) {
      const orgId = typeof doc.org_id === "string" ? doc.org_id : null;
      const ownerId = typeof doc.owner_user_id === "string" ? doc.owner_user_id : null;
      const docTitle = typeof doc.title === "string" ? doc.title : "Document";

      if (!orgId) continue;

      // In-app notification to owner
      if (ownerId) {
        void createNotification({
          orgId,
          userId: ownerId,
          type: "document_expired",
          title: "Document has expired",
          body: `${docTitle} expired on ${expiredDate}. Please renew it immediately.`,
          link: `/documents/${doc.id}`
        });

        sendDocumentExpiredEmail({
          orgId,
          userId: ownerId,
          documentTitle: docTitle
        }).catch(err => console.error('Document expired email send failed:', err));
      }

      expiredNotified++;
    }
  }

  return NextResponse.json({
    message: `Sent warnings for ${warningsSent} expiring document(s), notified ${expiredNotified} expired document(s)`,
    expiryDate,
    expiredDate,
    documentsFound: documents?.length ?? 0,
    expiredFound: expiredDocs?.length ?? 0
  });
}
