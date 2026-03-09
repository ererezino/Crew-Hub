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

/* ---------------------------------------------------------------------------
 * Helper: fetch emails for all users with a given role in an org
 * -------------------------------------------------------------------------*/

async function fetchEmailsByRole({
  orgId,
  role
}: {
  orgId: string;
  role: string;
}): Promise<string[]> {
  const serviceClient = createSupabaseServiceRoleClient();
  const { data, error } = await serviceClient
    .from("profiles")
    .select("email")
    .eq("org_id", orgId)
    .contains("roles", [role])
    .is("deleted_at", null);

  if (error) {
    console.error("Unable to resolve users by role for notification.", {
      orgId,
      role,
      message: error.message
    });
    return [];
  }

  return (data ?? [])
    .map((r) => r.email)
    .filter((e): e is string => typeof e === "string" && e.length > 0);
}

/* ---------------------------------------------------------------------------
 * Welcome email (direct – no DB lookup needed)
 * -------------------------------------------------------------------------*/

export async function sendWelcomeEmail({
  recipientEmail,
  recipientName,
  loginUrl,
  setupLink
}: {
  recipientEmail: string;
  recipientName: string;
  loginUrl?: string;
  setupLink?: string;
}): Promise<void> {
  try {
    const firstName = recipientName.trim().split(/\s+/)[0] || "there";
    const effectiveLoginUrl = loginUrl || "https://app.crew-hub.local/login";

    const setupInstruction = setupLink
      ? `To get started, click the link below to set your password:\n${setupLink}`
      : `To get started, contact your admin for a setup link. Once you have set your password you can sign in at ${effectiveLoginUrl}.`;

    await sendResendEmail({
      to: [recipientEmail],
      subject: `Welcome to Accrue, ${firstName}!`,
      text: [
        `Hello ${recipientName},`,
        "",
        "Welcome to the team! Your Crew Hub account has been created.",
        "",
        `Your login email is: ${recipientEmail}`,
        "",
        setupInstruction,
        "",
        "If you have any questions, reach out to your manager or HR.",
        "",
        "-- The Crew Hub Team"
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected welcome email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Leave notifications
 * -------------------------------------------------------------------------*/

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

export async function sendLeaveRequestedEmail({
  orgId,
  managerId,
  employeeName,
  leaveType,
  startDate,
  endDate
}: {
  orgId: string;
  managerId: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  try {
    const manager = await fetchRecipientProfile({
      orgId,
      userId: managerId
    });

    if (!manager) {
      return;
    }

    await sendResendEmail({
      to: [manager.email],
      subject: `Crew Hub: New leave request from ${employeeName}`,
      text: [
        `Hello ${manager.fullName},`,
        "",
        `${employeeName} has requested ${formatLeaveTypeLabel(leaveType)} leave for ${formatDateRangeHuman(startDate, endDate)}.`,
        "",
        "View in Crew Hub > Time Off to approve or decline this request."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected leave requested email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendLeaveCancelledEmail({
  orgId,
  managerId,
  employeeName,
  leaveType,
  startDate,
  endDate
}: {
  orgId: string;
  managerId: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  try {
    const manager = await fetchRecipientProfile({
      orgId,
      userId: managerId
    });

    if (!manager) {
      return;
    }

    await sendResendEmail({
      to: [manager.email],
      subject: `Crew Hub: Leave cancelled by ${employeeName}`,
      text: [
        `Hello ${manager.fullName},`,
        "",
        `${employeeName} has cancelled their ${formatLeaveTypeLabel(leaveType)} leave for ${formatDateRangeHuman(startDate, endDate)}.`,
        "",
        "View in Crew Hub > Time Off for details."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected leave cancelled email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Payslip notifications
 * -------------------------------------------------------------------------*/

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

/* ---------------------------------------------------------------------------
 * Compliance notifications
 * -------------------------------------------------------------------------*/

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

export async function sendComplianceOverdueEmail({
  orgId,
  userId,
  requirement
}: {
  orgId: string;
  userId: string;
  requirement: string;
}): Promise<void> {
  try {
    const owner = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });

    if (owner) {
      await sendResendEmail({
        to: [owner.email],
        subject: `Crew Hub: Compliance overdue – ${requirement}`,
        text: [
          `Hello ${owner.fullName},`,
          "",
          `The compliance requirement "${requirement}" is now overdue. Please complete it immediately to avoid further escalation.`,
          "",
          "View in Crew Hub > Compliance to take action."
        ].join("\n")
      });
    }

    if (hrEmails.length > 0) {
      await sendResendEmail({
        to: hrEmails,
        subject: `Crew Hub: Compliance overdue – ${requirement}`,
        text: [
          "Hello,",
          "",
          `The compliance requirement "${requirement}" assigned to ${owner?.fullName ?? "a team member"} is now overdue and may require escalation.`,
          "",
          "View in Crew Hub > Compliance to review overdue items."
        ].join("\n")
      });
    }
  } catch (error) {
    console.error("Unexpected compliance overdue email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Signature notifications
 * -------------------------------------------------------------------------*/

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

/* ---------------------------------------------------------------------------
 * Performance review notifications
 * -------------------------------------------------------------------------*/

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
  cycleName,
  employeeName
}: {
  orgId: string;
  userId: string;
  cycleName: string;
  employeeName: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: ${employeeName} acknowledged ${cycleName}`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `${employeeName} has acknowledged their ${cycleName} review.`,
        "",
        "Open Crew Hub > Performance to continue follow-up actions."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected review acknowledged email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Document notifications
 * -------------------------------------------------------------------------*/

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

export async function sendDocumentExpiredEmail({
  orgId,
  userId,
  documentTitle
}: {
  orgId: string;
  userId: string;
  documentTitle: string;
}): Promise<void> {
  try {
    const employee = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });

    if (employee) {
      await sendResendEmail({
        to: [employee.email],
        subject: `Crew Hub: ${documentTitle} has expired`,
        text: [
          `Hello ${employee.fullName},`,
          "",
          `Your document "${documentTitle}" has expired. Please upload a renewed version as soon as possible.`,
          "",
          "View in Crew Hub > Documents to upload the renewal."
        ].join("\n")
      });
    }

    if (hrEmails.length > 0) {
      await sendResendEmail({
        to: hrEmails,
        subject: `Crew Hub: ${documentTitle} has expired`,
        text: [
          "Hello,",
          "",
          `The document "${documentTitle}" for ${employee?.fullName ?? "a team member"} has expired and requires follow-up.`,
          "",
          "View in Crew Hub > Documents to review expired documents."
        ].join("\n")
      });
    }
  } catch (error) {
    console.error("Unexpected document expired email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Expense notifications
 * -------------------------------------------------------------------------*/

export async function sendExpenseSubmittedEmail({
  orgId,
  userId,
  managerId,
  amount,
  description
}: {
  orgId: string;
  userId: string;
  managerId: string;
  amount: string;
  description: string;
}): Promise<void> {
  try {
    const [employee, manager] = await Promise.all([
      fetchRecipientProfile({ orgId, userId }),
      fetchRecipientProfile({ orgId, userId: managerId })
    ]);

    if (employee) {
      await sendResendEmail({
        to: [employee.email],
        subject: `Crew Hub: Expense submitted – ${description}`,
        text: [
          `Hello ${employee.fullName},`,
          "",
          `Your expense "${description}" for ${amount} has been submitted and is pending approval.`,
          "",
          "View in Crew Hub > Expenses to track its status."
        ].join("\n")
      });
    }

    if (manager) {
      await sendResendEmail({
        to: [manager.email],
        subject: `Crew Hub: New expense awaiting approval – ${description}`,
        text: [
          `Hello ${manager.fullName},`,
          "",
          `${employee?.fullName ?? "A team member"} submitted an expense "${description}" for ${amount} that requires your approval.`,
          "",
          "View in Crew Hub > Expenses to review and approve or reject."
        ].join("\n")
      });
    }
  } catch (error) {
    console.error("Unexpected expense submitted email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendExpenseApprovedEmail({
  orgId,
  userId,
  amount,
  description
}: {
  orgId: string;
  userId: string;
  amount: string;
  description: string;
}): Promise<void> {
  try {
    const employee = await fetchRecipientProfile({ orgId, userId });
    const financeEmails = await fetchEmailsByRole({
      orgId,
      role: "FINANCE_ADMIN"
    });

    if (employee) {
      await sendResendEmail({
        to: [employee.email],
        subject: `Crew Hub: Expense approved – ${description}`,
        text: [
          `Hello ${employee.fullName},`,
          "",
          `Your expense "${description}" for ${amount} has been approved. It will be processed for disbursement.`,
          "",
          "View in Crew Hub > Expenses to track disbursement."
        ].join("\n")
      });
    }

    if (financeEmails.length > 0) {
      await sendResendEmail({
        to: financeEmails,
        subject: `Crew Hub: Expense approved and ready for disbursement – ${description}`,
        text: [
          "Hello,",
          "",
          `An expense "${description}" for ${amount} (submitted by ${employee?.fullName ?? "a team member"}) has been approved and is ready for disbursement.`,
          "",
          "View in Crew Hub > Expenses to process the payment."
        ].join("\n")
      });
    }
  } catch (error) {
    console.error("Unexpected expense approved email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendExpenseRejectedEmail({
  orgId,
  userId,
  amount,
  description,
  reason
}: {
  orgId: string;
  userId: string;
  amount: string;
  description: string;
  reason: string;
}): Promise<void> {
  try {
    const employee = await fetchRecipientProfile({ orgId, userId });

    if (!employee) {
      return;
    }

    await sendResendEmail({
      to: [employee.email],
      subject: `Crew Hub: Expense rejected – ${description}`,
      text: [
        `Hello ${employee.fullName},`,
        "",
        `Your expense "${description}" for ${amount} has been rejected.`,
        `Reason: ${reason}`,
        "",
        "View in Crew Hub > Expenses to review or resubmit."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected expense rejected email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendExpenseDisbursedEmail({
  orgId,
  userId,
  amount,
  description
}: {
  orgId: string;
  userId: string;
  amount: string;
  description: string;
}): Promise<void> {
  try {
    const employee = await fetchRecipientProfile({ orgId, userId });

    if (!employee) {
      return;
    }

    await sendResendEmail({
      to: [employee.email],
      subject: `Crew Hub: Expense disbursed – ${description}`,
      text: [
        `Hello ${employee.fullName},`,
        "",
        `Your expense "${description}" for ${amount} has been disbursed. Please check your account for the payment.`,
        "",
        "View in Crew Hub > Expenses for full details."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected expense disbursed email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Onboarding notifications
 * -------------------------------------------------------------------------*/

export async function sendOnboardingStartedEmail({
  orgId,
  userId,
  managerId,
  employeeName
}: {
  orgId: string;
  userId: string;
  managerId: string;
  employeeName: string;
}): Promise<void> {
  try {
    const [employee, manager] = await Promise.all([
      fetchRecipientProfile({ orgId, userId }),
      fetchRecipientProfile({ orgId, userId: managerId })
    ]);

    if (employee) {
      await sendResendEmail({
        to: [employee.email],
        subject: "Crew Hub: Welcome aboard! Your onboarding has started",
        text: [
          `Hello ${employee.fullName},`,
          "",
          "Welcome to the team! Your onboarding checklist is ready. Please complete the assigned tasks at your earliest convenience.",
          "",
          "View in Crew Hub > Onboarding to get started."
        ].join("\n")
      });
    }

    if (manager) {
      await sendResendEmail({
        to: [manager.email],
        subject: `Crew Hub: Onboarding started for ${employeeName}`,
        text: [
          `Hello ${manager.fullName},`,
          "",
          `Onboarding for ${employeeName} has started. You can track their progress and assist with any tasks assigned to you.`,
          "",
          "View in Crew Hub > Onboarding to monitor progress."
        ].join("\n")
      });
    }
  } catch (error) {
    console.error("Unexpected onboarding started email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendOnboardingTaskOverdueEmail({
  orgId,
  userId,
  taskName
}: {
  orgId: string;
  userId: string;
  taskName: string;
}): Promise<void> {
  try {
    const employee = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });

    if (employee) {
      await sendResendEmail({
        to: [employee.email],
        subject: `Crew Hub: Onboarding task overdue – ${taskName}`,
        text: [
          `Hello ${employee.fullName},`,
          "",
          `Your onboarding task "${taskName}" is overdue. Please complete it as soon as possible.`,
          "",
          "View in Crew Hub > Onboarding to complete the task."
        ].join("\n")
      });
    }

    if (hrEmails.length > 0) {
      await sendResendEmail({
        to: hrEmails,
        subject: `Crew Hub: Onboarding task overdue – ${taskName}`,
        text: [
          "Hello,",
          "",
          `The onboarding task "${taskName}" for ${employee?.fullName ?? "a new hire"} is overdue and may need follow-up.`,
          "",
          "View in Crew Hub > Onboarding to review progress."
        ].join("\n")
      });
    }
  } catch (error) {
    console.error("Unexpected onboarding task overdue email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendOnboardingCompleteEmail({
  orgId,
  userId,
  managerId,
  employeeName
}: {
  orgId: string;
  userId: string;
  managerId: string;
  employeeName: string;
}): Promise<void> {
  try {
    const [employee, manager] = await Promise.all([
      fetchRecipientProfile({ orgId, userId }),
      fetchRecipientProfile({ orgId, userId: managerId })
    ]);
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });

    if (employee) {
      await sendResendEmail({
        to: [employee.email],
        subject: "Crew Hub: Onboarding complete!",
        text: [
          `Hello ${employee.fullName},`,
          "",
          "Congratulations! You have completed all your onboarding tasks. Welcome to the team!",
          "",
          "View in Crew Hub > Onboarding for a summary."
        ].join("\n")
      });
    }

    const notifyEmails: string[] = [
      ...(manager ? [manager.email] : []),
      ...hrEmails
    ];

    if (notifyEmails.length > 0) {
      await sendResendEmail({
        to: notifyEmails,
        subject: `Crew Hub: Onboarding complete for ${employeeName}`,
        text: [
          "Hello,",
          "",
          `${employeeName} has completed all onboarding tasks.`,
          "",
          "View in Crew Hub > Onboarding to review the summary."
        ].join("\n")
      });
    }
  } catch (error) {
    console.error("Unexpected onboarding complete email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Scheduling notifications
 * -------------------------------------------------------------------------*/

export async function sendSchedulePublishedEmail({
  orgId,
  userId,
  scheduleName,
  month,
  year
}: {
  orgId: string;
  userId: string;
  scheduleName: string;
  month: string;
  year: string;
}): Promise<void> {
  try {
    const recipient = await fetchRecipientProfile({ orgId, userId });

    if (!recipient) {
      return;
    }

    await sendResendEmail({
      to: [recipient.email],
      subject: `Crew Hub: ${scheduleName} schedule published for ${month} ${year}`,
      text: [
        `Hello ${recipient.fullName},`,
        "",
        `The ${scheduleName} schedule for ${month} ${year} has been published. Please review your assigned shifts.`,
        "",
        "View in Crew Hub > Scheduling to see your shifts."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected schedule published email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendSwapRequestedEmail({
  orgId,
  targetUserId,
  requesterName,
  shiftDate
}: {
  orgId: string;
  targetUserId: string;
  requesterName: string;
  shiftDate: string;
}): Promise<void> {
  try {
    const target = await fetchRecipientProfile({
      orgId,
      userId: targetUserId
    });

    if (!target) {
      return;
    }

    await sendResendEmail({
      to: [target.email],
      subject: `Crew Hub: Shift swap request from ${requesterName}`,
      text: [
        `Hello ${target.fullName},`,
        "",
        `${requesterName} has requested to swap shifts with you on ${shiftDate}. Please review and respond.`,
        "",
        "View in Crew Hub > Scheduling to accept or decline the swap."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected swap requested email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendSwapAcceptedEmail({
  orgId,
  requesterId,
  targetName,
  shiftDate
}: {
  orgId: string;
  requesterId: string;
  targetName: string;
  shiftDate: string;
}): Promise<void> {
  try {
    const requester = await fetchRecipientProfile({
      orgId,
      userId: requesterId
    });

    if (!requester) {
      return;
    }

    await sendResendEmail({
      to: [requester.email],
      subject: `Crew Hub: Shift swap accepted by ${targetName}`,
      text: [
        `Hello ${requester.fullName},`,
        "",
        `${targetName} has accepted your shift swap request for ${shiftDate}. Your schedule has been updated.`,
        "",
        "View in Crew Hub > Scheduling to see your updated shifts."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected swap accepted email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * Payroll notifications
 * -------------------------------------------------------------------------*/

export async function sendPayrollApprovedEmail({
  orgId,
  userId,
  runName
}: {
  orgId: string;
  userId: string;
  runName: string;
}): Promise<void> {
  try {
    const financeEmails = await fetchEmailsByRole({
      orgId,
      role: "FINANCE_ADMIN"
    });
    const adminEmails = await fetchEmailsByRole({
      orgId,
      role: "SUPER_ADMIN"
    });
    const approver = await fetchRecipientProfile({ orgId, userId });

    const notifyEmails = [...financeEmails, ...adminEmails];

    if (notifyEmails.length === 0) {
      return;
    }

    await sendResendEmail({
      to: notifyEmails,
      subject: `Crew Hub: Payroll run approved – ${runName}`,
      text: [
        "Hello,",
        "",
        `The payroll run "${runName}" has been approved${approver ? ` by ${approver.fullName}` : ""} and is ready for processing.`,
        "",
        "View in Crew Hub > Payroll to process the run."
      ].join("\n")
    });
  } catch (error) {
    console.error("Unexpected payroll approved email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
