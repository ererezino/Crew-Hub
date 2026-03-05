import "server-only";

import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import { formatDateRangeHuman } from "../datetime";
import { formatLeaveTypeLabel } from "../time-off";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_FROM = "Crew Hub <no-reply@crew-hub.local>";

type ResendPayload = {
  to: string[];
  subject: string;
  text: string;
};

type RecipientProfile = {
  email: string;
  fullName: string;
};

async function fetchRecipientProfile({
  orgId,
  userId
}: {
  orgId: string;
  userId: string;
}): Promise<RecipientProfile | null> {
  const serviceClient = createSupabaseServiceRoleClient();
  const { data: row, error } = await serviceClient
    .from("profiles")
    .select("email, full_name")
    .eq("org_id", orgId)
    .eq("id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("Unable to resolve notification email recipient.", {
      orgId,
      userId,
      message: error.message
    });
    return null;
  }

  if (!row?.email || typeof row.email !== "string") {
    return null;
  }

  return {
    email: row.email,
    fullName: typeof row.full_name === "string" ? row.full_name : "Crew member"
  };
}

async function sendResendEmail(payload: ResendPayload): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey || payload.to.length === 0) {
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [...new Set(payload.to)],
      subject: payload.subject,
      text: payload.text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to send Resend notification email.", {
      status: response.status,
      body: errorText
    });
  }
}

export async function sendLeaveStatusEmail({
  orgId,
  userId,
  leaveType,
  status,
  startDate,
  endDate,
  rejectionReason
}: {
  orgId: string;
  userId: string;
  leaveType: string;
  status: "approved" | "rejected";
  startDate: string;
  endDate: string;
  rejectionReason?: string | null;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    const subjectPrefix = status === "approved" ? "Approved" : "Update";
    const lines = [
      `Hello ${recipient.fullName},`,
      "",
      `Your ${formatLeaveTypeLabel(leaveType)} request (${formatDateRangeHuman(startDate, endDate)}) is ${status}.`
    ];

    if (status === "rejected" && rejectionReason?.trim()) {
      lines.push(`Reason: ${rejectionReason.trim()}`);
    }

    lines.push("", "Open Crew Hub to view details.");

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: ${subjectPrefix} leave request`,
      text: lines.join("\n")
    });
  } catch (error) {
    console.error("Unexpected leave status email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendPayslipReadyEmail({
  orgId,
  userId,
  payPeriod
}: {
  orgId: string;
  userId: string;
  payPeriod: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: Payment statement ready (${payPeriod})`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `Your payment statement for ${payPeriod} is now available in Crew Hub.`,
        "",
        "Open Crew Hub > Payments to view or download it."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected payslip ready email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendComplianceReminderEmail({
  orgId,
  userId,
  requirement,
  dueDate
}: {
  orgId: string;
  userId: string;
  requirement: string;
  dueDate: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: Compliance reminder for ${requirement}`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `Reminder: "${requirement}" has a compliance deadline on ${dueDate}.`,
        "",
        "Open Crew Hub > Compliance to review status and attach proof."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected compliance reminder email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendSignatureRequestEmail({
  orgId,
  userId,
  requestTitle,
  requestedByName
}: {
  orgId: string;
  userId: string;
  requestTitle: string;
  requestedByName: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: Signature request - ${requestTitle}`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `${requestedByName} requested your signature on "${requestTitle}".`,
        "",
        "Open Crew Hub > Signatures to review and sign the document."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected signature request email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendReviewCycleStartedEmail({
  orgId,
  userId,
  cycleName,
  selfReviewDeadline
}: {
  orgId: string;
  userId: string;
  cycleName: string;
  selfReviewDeadline: string | null;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    const deadlineText = selfReviewDeadline
      ? ` Your self-review is due by ${selfReviewDeadline}.`
      : "";

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: ${cycleName} review has started`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `Your ${cycleName} review has started.${deadlineText}`,
        "",
        "Open Crew Hub > Performance to get started."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected review cycle started email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendReviewReminderEmail({
  orgId,
  userId,
  cycleName,
  deadline
}: {
  orgId: string;
  userId: string;
  cycleName: string;
  deadline: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: Self-review due soon for ${cycleName}`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `Your self-review for ${cycleName} is due in 2 days. Complete it before ${deadline}.`,
        "",
        "Open Crew Hub > Performance to submit your self-review."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected review reminder email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendReviewSharedEmail({
  orgId,
  userId,
  cycleName
}: {
  orgId: string;
  userId: string;
  cycleName: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: Your ${cycleName} review has been shared`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `Your ${cycleName} review has been shared with you. Tap to read.`,
        "",
        "Open Crew Hub > Performance to view your review."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected review shared email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendReviewAcknowledgedEmail({
  orgId,
  userId,
  employeeName,
  cycleName
}: {
  orgId: string;
  userId: string;
  employeeName: string;
  cycleName: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: ${employeeName} acknowledged their ${cycleName} review`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `${employeeName} has acknowledged their ${cycleName} review.`,
        "",
        "Open Crew Hub > Performance to view details."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected review acknowledged email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendDocumentExpiryEmail({
  orgId,
  userId,
  documentTitle,
  expiryDate
}: {
  orgId: string;
  userId: string;
  documentTitle: string;
  expiryDate: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: ${documentTitle} expires on ${expiryDate}`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `"${documentTitle}" expires on ${expiryDate}. Please renew it.`,
        "",
        "Open Crew Hub > Documents to view and renew the document."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected document expiry email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
