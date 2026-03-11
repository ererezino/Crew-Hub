import "server-only";

import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import { formatDateRangeHuman } from "../datetime";
import { formatLeaveTypeLabel } from "../time-off";
import {
  renderEmailTemplate,
  renderInfoBlock,
  p,
  pLast
} from "./email-template";
import { isEmailEnabled } from "./email-config";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function resolveResendFrom(): string {
  const configuredFrom = process.env.RESEND_FROM?.trim();
  if (configuredFrom && configuredFrom.length > 0) {
    return configuredFrom;
  }
  return "Crew Hub <onboarding@resend.dev>";
}

function resolveAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://crew.useaccrue.com"
  );
}

type ResendPayload = {
  to: string[];
  subject: string;
  html: string;
};

type RecipientProfile = {
  email: string;
  fullName: string;
};

/* ---------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------*/

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
      from: resolveResendFrom(),
      to: [...new Set(payload.to)],
      subject: payload.subject,
      html: payload.html
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

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

/* ---------------------------------------------------------------------------
 * Notification preference check
 *
 * Categories:
 *   announcements: review cycle, review shared, review reminders,
 *     schedule published, document expiry, compliance reminders,
 *     onboarding started/completed
 *   approvals: leave status, expense status, signature requests,
 *     payroll approval, payment details updated, swap requests
 *
 * Auth emails (welcome, invite, reset) always send.
 * -------------------------------------------------------------------------*/

export type EmailCategory = "announcements" | "approvals";

export async function checkEmailPreference(
  orgId: string,
  userId: string,
  category: EmailCategory
): Promise<boolean> {
  try {
    const serviceClient = createSupabaseServiceRoleClient();
    const { data, error } = await serviceClient
      .from("profiles")
      .select("notification_preferences")
      .eq("org_id", orgId)
      .eq("id", userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) {
      // Default to sending if we cannot resolve preferences
      return true;
    }

    const prefs = data.notification_preferences as Record<string, unknown> | null;
    if (!prefs) {
      return true;
    }

    if (category === "announcements") {
      return prefs.emailAnnouncements !== false;
    }
    if (category === "approvals") {
      return prefs.emailApprovals !== false;
    }

    return true;
  } catch {
    return true;
  }
}

/* ---------------------------------------------------------------------------
 * 1. Welcome Email - NEW HIRE (ACTIVE, auth - always sends)
 * -------------------------------------------------------------------------*/

export async function sendWelcomeEmail({
  recipientEmail,
  recipientName,
  setupLink,
  department,
  managerName,
  isNewHire = true
}: {
  recipientEmail: string;
  recipientName: string;
  setupLink?: string;
  department?: string;
  managerName?: string;
  isNewHire?: boolean;
}): Promise<void> {
  try {
    const name = firstName(recipientName);
    const appUrl = resolveAppUrl();
    const effectiveSetupLink = setupLink || `${appUrl}/login`;

    if (isNewHire) {
      // Template 1: New Hire Welcome
      const infoRows: Array<{ label: string; value: string }> = [
        { label: "Login email", value: recipientEmail }
      ];
      if (department) {
        infoRows.push({ label: "Your team", value: department });
      }
      if (managerName) {
        infoRows.push({ label: "Your manager", value: managerName });
      }

      const html = renderEmailTemplate({
        preheaderText: "Your Crew Hub account is ready",
        greeting: `Hey ${name},`,
        bodyHtml: [
          p("Welcome to Accrue. We're glad you're here."),
          p(
            "Your Crew Hub account is ready. Crew Hub is where you'll find everything you need: your team, your pay, your time off, and your documents. Think of it as home base."
          ),
          pLast(
            "To get started, tap the button below to set up your login and authenticator:"
          ),
          renderInfoBlock(infoRows)
        ].join("\n"),
        ctaButton: {
          label: "Set Up Your Account",
          url: effectiveSetupLink,
          style: "cta"
        },
        closingText:
          "If anything feels off or you have questions, reach out to your manager or the Operations team."
      });

      await sendResendEmail({
        to: [recipientEmail],
        subject: `Welcome to Accrue, ${name}`,
        html
      });
    } else {
      // Template 2: Existing Employee Invite
      const html = renderEmailTemplate({
        preheaderText: "Set up your login to get started",
        greeting: `Hey ${name},`,
        bodyHtml: [
          p(
            "We've set up Crew Hub, a new internal platform for the Accrue team. It's where you'll manage your pay, time off, documents, and team info going forward."
          ),
          pLast("Your account is ready. Tap below to set up your login:"),
          renderInfoBlock([{ label: "Login email", value: recipientEmail }])
        ].join("\n"),
        ctaButton: {
          label: "Get Started",
          url: effectiveSetupLink,
          style: "cta"
        },
        closingText:
          "Everything you need will be in one place. If you run into any issues getting set up, reach out to the Operations team."
      });

      await sendResendEmail({
        to: [recipientEmail],
        subject: "Your Crew Hub account is ready",
        html
      });
    }
  } catch (error) {
    console.error("Unexpected welcome email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 3. Leave Request Approved (ACTIVE)
 * -------------------------------------------------------------------------*/

export async function sendLeaveStatusEmail({
  orgId,
  userId,
  leaveType,
  status,
  startDate,
  endDate,
  rejectionReason,
  approverName
}: {
  orgId: string;
  userId: string;
  leaveType: string;
  status: "approved" | "rejected";
  startDate: string;
  endDate: string;
  rejectionReason?: string | null;
  approverName?: string;
}): Promise<void> {
  try {
    const featureKey = status === "approved" ? "leaveApproved" : "leaveDenied";
    if (!isEmailEnabled(featureKey)) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(orgId, userId, "approvals");
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();
    const dateRange = formatDateRangeHuman(startDate, endDate);
    const resolvedApprover = approverName || "your manager";

    if (status === "approved") {
      const infoRows = [
        { label: "Type", value: formatLeaveTypeLabel(leaveType) },
        { label: "Dates", value: dateRange },
        { label: "Approved by", value: resolvedApprover }
      ];

      const html = renderEmailTemplate({
        preheaderText: "You're all set",
        greeting: `Hey ${name},`,
        bodyHtml: [
          p("Your time off request has been approved."),
          renderInfoBlock(infoRows),
          pLast("It's on the calendar. Enjoy your time.")
        ].join("\n"),
        ctaButton: {
          label: "View in Crew Hub",
          url: `${appUrl}/time-off`,
          style: "cta"
        }
      });

      await sendResendEmail({
        to: [recipient.email],
        subject: "Your time off is approved",
        html
      });
    } else {
      const infoRows = [
        { label: "Type", value: formatLeaveTypeLabel(leaveType) },
        { label: "Dates", value: dateRange },
        { label: "Reviewed by", value: resolvedApprover }
      ];
      if (rejectionReason?.trim()) {
        infoRows.push({ label: "Reason", value: rejectionReason.trim() });
      }

      const html = renderEmailTemplate({
        preheaderText: "Your request was reviewed",
        greeting: `Hey ${name},`,
        bodyHtml: [
          p("Your time off request was not approved."),
          renderInfoBlock(infoRows),
          pLast(
            `If you'd like to discuss or adjust the dates, reach out to ${resolvedApprover} directly.`
          )
        ].join("\n"),
        ctaButton: {
          label: "View in Crew Hub",
          url: `${appUrl}/time-off`,
          style: "primary"
        }
      });

      await sendResendEmail({
        to: [recipient.email],
        subject: "Update on your time off request",
        html
      });
    }
  } catch (error) {
    console.error("Unexpected leave status email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 5. Leave Submitted to Manager (ACTIVE)
 * -------------------------------------------------------------------------*/

export async function sendLeaveRequestedEmail({
  orgId,
  managerId,
  employeeName,
  leaveType,
  startDate,
  endDate,
  note
}: {
  orgId: string;
  managerId: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  note?: string | null;
}): Promise<void> {
  try {
    if (!isEmailEnabled("leaveSubmitted")) return;

    const manager = await fetchRecipientProfile({ orgId, userId: managerId });
    if (!manager) return;

    const canSend = await checkEmailPreference(orgId, managerId, "approvals");
    if (!canSend) return;

    const managerFirst = firstName(manager.fullName);
    const appUrl = resolveAppUrl();
    const dateRange = formatDateRangeHuman(startDate, endDate);

    const infoRows: Array<{ label: string; value: string }> = [
      { label: "Type", value: formatLeaveTypeLabel(leaveType) },
      { label: "Dates", value: dateRange }
    ];
    if (note?.trim()) {
      infoRows.push({ label: "Note", value: note.trim() });
    }

    const html = renderEmailTemplate({
      preheaderText: "Review their request",
      greeting: `Hey ${managerFirst},`,
      bodyHtml: [
        p(`${employeeName} submitted a time off request:`),
        renderInfoBlock(infoRows)
      ].join("\n"),
      ctaButton: {
        label: "Review Request",
        url: `${appUrl}/time-off`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [manager.email],
      subject: `${employeeName} requested time off`,
      html
    });
  } catch (error) {
    console.error("Unexpected leave requested email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 6. Leave Cancelled (DORMANT)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("leaveCancelled")) return;

    const manager = await fetchRecipientProfile({ orgId, userId: managerId });
    if (!manager) return;

    const canSend = await checkEmailPreference(orgId, managerId, "approvals");
    if (!canSend) return;

    const managerFirst = firstName(manager.fullName);
    const dateRange = formatDateRangeHuman(startDate, endDate);

    const html = renderEmailTemplate({
      preheaderText: "No action needed",
      greeting: `Hey ${managerFirst},`,
      bodyHtml: [
        p(`${employeeName} cancelled their time off request:`),
        renderInfoBlock([
          { label: "Type", value: formatLeaveTypeLabel(leaveType) },
          { label: "Dates", value: dateRange }
        ]),
        p("No action needed on your end.")
      ].join("\n")
    });

    await sendResendEmail({
      to: [manager.email],
      subject: `${employeeName} cancelled their time off`,
      html
    });
  } catch (error) {
    console.error("Unexpected leave cancelled email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 7. Payslip Ready (ACTIVE)
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
    if (!isEmailEnabled("payslipReady")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(orgId, userId, "announcements");
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "View your payment statement",
      greeting: `Hey ${name},`,
      bodyHtml: [
        pLast(
          `Your payslip for ${payPeriod} is now available in Crew Hub.`
        )
      ].join("\n"),
      ctaButton: {
        label: "View Payslip",
        url: `${appUrl}/payments`,
        style: "cta"
      },
      closingText:
        "If anything looks off, reach out to the Operations team."
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `Your payslip for ${payPeriod} is ready`,
      html
    });
  } catch (error) {
    console.error("Unexpected payslip ready email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 8 & 9. Expense Submitted (ACTIVE) - to Employee + Manager
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
    if (!isEmailEnabled("expenseSubmitted")) return;

    const [employee, manager] = await Promise.all([
      fetchRecipientProfile({ orgId, userId }),
      fetchRecipientProfile({ orgId, userId: managerId })
    ]);

    const appUrl = resolveAppUrl();

    // Template 8: to Employee
    if (employee) {
      const canSend = await checkEmailPreference(orgId, userId, "approvals");
      if (canSend) {
        const name = firstName(employee.fullName);
        const html = renderEmailTemplate({
          preheaderText: "We've got it",
          greeting: `Hey ${name},`,
          bodyHtml: [
            p("Your expense claim has been submitted and is pending review."),
            renderInfoBlock([
              { label: "Expense", value: description },
              { label: "Amount", value: amount }
            ]),
            pLast("You'll get an update once it's reviewed.")
          ].join("\n"),
          ctaButton: {
            label: "View Expense",
            url: `${appUrl}/expenses`,
            style: "cta"
          }
        });

        await sendResendEmail({
          to: [employee.email],
          subject: "Your expense was submitted",
          html
        });
      }
    }

    // Template 9: to Manager
    if (manager) {
      const canSend = await checkEmailPreference(
        orgId,
        managerId,
        "approvals"
      );
      if (canSend) {
        const managerFirst = firstName(manager.fullName);
        const html = renderEmailTemplate({
          preheaderText: "Review needed",
          greeting: `Hey ${managerFirst},`,
          bodyHtml: [
            p(
              `${employee?.fullName || "A team member"} submitted an expense for your review:`
            ),
            renderInfoBlock([
              { label: "Expense", value: description },
              { label: "Amount", value: amount }
            ])
          ].join("\n"),
          ctaButton: {
            label: "Review Expense",
            url: `${appUrl}/expenses`,
            style: "cta"
          }
        });

        await sendResendEmail({
          to: [manager.email],
          subject: `${employee?.fullName || "A team member"} submitted an expense`,
          html
        });
      }
    }
  } catch (error) {
    console.error("Unexpected expense submitted email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 10 & 11. Expense Approved (ACTIVE) - to Employee + Finance
 * -------------------------------------------------------------------------*/

export async function sendExpenseApprovedEmail({
  orgId,
  userId,
  amount,
  description,
  approverName
}: {
  orgId: string;
  userId: string;
  amount: string;
  description: string;
  approverName?: string;
}): Promise<void> {
  try {
    if (!isEmailEnabled("expenseApproved")) return;

    const employee = await fetchRecipientProfile({ orgId, userId });
    const financeEmails = await fetchEmailsByRole({
      orgId,
      role: "FINANCE_ADMIN"
    });
    const appUrl = resolveAppUrl();
    const resolvedApprover = approverName || "your manager";

    // Template 10: to Employee
    if (employee) {
      const canSend = await checkEmailPreference(orgId, userId, "approvals");
      if (canSend) {
        const name = firstName(employee.fullName);
        const html = renderEmailTemplate({
          preheaderText: "Good news",
          greeting: `Hey ${name},`,
          bodyHtml: [
            p("Your expense claim has been approved."),
            renderInfoBlock([
              { label: "Expense", value: description },
              { label: "Amount", value: amount },
              { label: "Approved by", value: resolvedApprover }
            ])
          ].join("\n"),
          ctaButton: {
            label: "View Expense",
            url: `${appUrl}/expenses`,
            style: "cta"
          }
        });

        await sendResendEmail({
          to: [employee.email],
          subject: "Your expense was approved",
          html
        });
      }
    }

    // Template 11: to Finance
    if (financeEmails.length > 0) {
      const html = renderEmailTemplate({
        preheaderText: `${amount} for ${employee?.fullName || "a team member"}`,
        greeting: "Hey there,",
        bodyHtml: [
          p(
            "An expense has been approved and is ready for finance payment confirmation:"
          ),
          renderInfoBlock([
            {
              label: "Employee",
              value: employee?.fullName || "A team member"
            },
            { label: "Expense", value: description },
            { label: "Amount", value: amount },
            { label: "Approved by", value: resolvedApprover }
          ])
        ].join("\n"),
        ctaButton: {
          label: "Process in Crew Hub",
          url: `${appUrl}/expenses`,
          style: "cta"
        }
      });

      await sendResendEmail({
        to: financeEmails,
        subject: `Expense approved, ready for payment confirmation: ${description}`,
        html
      });
    }
  } catch (error) {
    console.error("Unexpected expense approved email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 12. Expense Rejected (ACTIVE)
 * -------------------------------------------------------------------------*/

export async function sendExpenseRejectedEmail({
  orgId,
  userId,
  amount,
  description,
  reason,
  approverName
}: {
  orgId: string;
  userId: string;
  amount: string;
  description: string;
  reason?: string;
  approverName?: string;
}): Promise<void> {
  try {
    if (!isEmailEnabled("expenseRejected")) return;

    const employee = await fetchRecipientProfile({ orgId, userId });
    if (!employee) return;

    const canSend = await checkEmailPreference(orgId, userId, "approvals");
    if (!canSend) return;

    const name = firstName(employee.fullName);
    const appUrl = resolveAppUrl();
    const resolvedApprover = approverName || "your manager";

    const infoRows = [
      { label: "Expense", value: description },
      { label: "Amount", value: amount },
      { label: "Reviewed by", value: resolvedApprover }
    ];
    if (reason?.trim()) {
      infoRows.push({ label: "Reason", value: reason.trim() });
    }

    const html = renderEmailTemplate({
      preheaderText: "Your expense was reviewed",
      greeting: `Hey ${name},`,
      bodyHtml: [
        p("Your expense claim was not approved."),
        renderInfoBlock(infoRows),
        pLast(
          `If you have questions or want to resubmit with changes, reach out to ${resolvedApprover} directly.`
        )
      ].join("\n"),
      ctaButton: {
        label: "View Expense",
        url: `${appUrl}/expenses`,
        style: "primary"
      }
    });

    await sendResendEmail({
      to: [employee.email],
      subject: "Update on your expense claim",
      html
    });
  } catch (error) {
    console.error("Unexpected expense rejected email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 13. Expense Disbursed (ACTIVE)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("expenseDisbursed")) return;

    const employee = await fetchRecipientProfile({ orgId, userId });
    if (!employee) return;

    const canSend = await checkEmailPreference(orgId, userId, "approvals");
    if (!canSend) return;

    const name = firstName(employee.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "Payment is on the way",
      greeting: `Hey ${name},`,
      bodyHtml: [
        p("Your expense claim has been reimbursed."),
        renderInfoBlock([
          { label: "Expense", value: description },
          { label: "Amount", value: amount }
        ]),
        pLast(
          "The payment should reflect in your account shortly."
        )
      ].join("\n"),
      ctaButton: {
        label: "View Expense",
        url: `${appUrl}/expenses`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [employee.email],
      subject: "Your expense has been reimbursed",
      html
    });
  } catch (error) {
    console.error("Unexpected expense disbursed email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 13b. Expense Info Requested (ACTIVE)
 * -------------------------------------------------------------------------*/

export async function sendExpenseInfoRequestedEmail({
  orgId,
  userId,
  requesterName,
  description,
  message
}: {
  orgId: string;
  userId: string;
  requesterName: string;
  description: string;
  message: string;
}): Promise<void> {
  try {
    if (!isEmailEnabled("expenseInfoRequested")) return;

    const employee = await fetchRecipientProfile({ orgId, userId });
    if (!employee) return;

    const canSend = await checkEmailPreference(orgId, userId, "approvals");
    if (!canSend) return;

    const name = firstName(employee.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "More details requested",
      greeting: `Hey ${name},`,
      bodyHtml: [
        p(`${requesterName} requested more information before approving your expense.`),
        renderInfoBlock([
          { label: "Expense", value: description },
          { label: "Request", value: message }
        ])
      ].join("\n"),
      ctaButton: {
        label: "Reply in Crew Hub",
        url: `${appUrl}/expenses`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [employee.email],
      subject: "More info requested for your expense",
      html
    });
  } catch (error) {
    console.error("Unexpected expense info-requested email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 13c. Expense Info Response (ACTIVE)
 * -------------------------------------------------------------------------*/

export async function sendExpenseInfoResponseEmail({
  orgId,
  userId,
  responderName,
  description,
  message
}: {
  orgId: string;
  userId: string;
  responderName: string;
  description: string;
  message: string;
}): Promise<void> {
  try {
    if (!isEmailEnabled("expenseInfoResponse")) return;

    const reviewer = await fetchRecipientProfile({ orgId, userId });
    if (!reviewer) return;

    const canSend = await checkEmailPreference(orgId, userId, "approvals");
    if (!canSend) return;

    const name = firstName(reviewer.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "Expense response received",
      greeting: `Hey ${name},`,
      bodyHtml: [
        p(`${responderName} replied to your request for more info.`),
        renderInfoBlock([
          { label: "Expense", value: description },
          { label: "Response", value: message }
        ])
      ].join("\n"),
      ctaButton: {
        label: "Review expense",
        url: `${appUrl}/expenses/approvals`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [reviewer.email],
      subject: "Expense response received",
      html
    });
  } catch (error) {
    console.error("Unexpected expense info-response email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 14. Signature Request (ACTIVE)
 * -------------------------------------------------------------------------*/

export async function sendSignatureRequestEmail({
  orgId,
  userId,
  requestTitle,
  requestedByName,
  signatureUrl
}: {
  orgId: string;
  userId: string;
  requestTitle: string;
  requestedByName: string;
  signatureUrl?: string;
}): Promise<void> {
  try {
    if (!isEmailEnabled("signatureRequest")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(orgId, userId, "approvals");
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: `${requestedByName} needs your signature`,
      greeting: `Hey ${name},`,
      bodyHtml: [
        p(`${requestedByName} has sent you a document to sign.`),
        renderInfoBlock([{ label: "Document", value: requestTitle }])
      ].join("\n"),
      ctaButton: {
        label: "Review and Sign",
        url: signatureUrl || `${appUrl}/signatures`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `Signature request: ${requestTitle}`,
      html
    });
  } catch (error) {
    console.error("Unexpected signature request email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 15. Payment Details Updated (ACTIVE)
 * -------------------------------------------------------------------------*/

export async function sendPaymentDetailsUpdatedEmail({
  orgId,
  employeeName,
  employeeEmail,
  paymentMethod,
  changeEffectiveAt
}: {
  orgId: string;
  employeeName: string;
  employeeEmail: string;
  paymentMethod: string;
  changeEffectiveAt: string;
}): Promise<void> {
  try {
    if (!isEmailEnabled("paymentDetailsUpdated")) return;

    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const adminEmails = await fetchEmailsByRole({ orgId, role: "SUPER_ADMIN" });
    const recipients = [...new Set([...hrEmails, ...adminEmails])];

    if (recipients.length === 0) return;

    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "Review the change",
      greeting: "Hey there,",
      bodyHtml: [
        p(
          `${employeeName} (${employeeEmail}) has updated their payment details.`
        ),
        renderInfoBlock([
          { label: "Payment method", value: paymentMethod },
          { label: "Effective", value: changeEffectiveAt }
        ]),
        pLast(
          "Please review and confirm the update is correct."
        )
      ].join("\n"),
      ctaButton: {
        label: "View in Crew Hub",
        url: `${appUrl}/people`,
        style: "primary"
      }
    });

    await sendResendEmail({
      to: recipients,
      subject: `Payment details updated for ${employeeName}`,
      html
    });
  } catch (error) {
    console.error("Unexpected payment details updated email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 16. Compliance Reminder (DORMANT)
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
    if (!isEmailEnabled("complianceReminder")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: `Action needed by ${dueDate}`,
      greeting: `Hey ${name},`,
      bodyHtml: [
        p("This is a reminder about an upcoming compliance deadline."),
        renderInfoBlock([
          { label: "Requirement", value: requirement },
          { label: "Due date", value: dueDate }
        ]),
        pLast(
          "Please make sure this is completed on time. If you need help, reach out to the Operations team."
        )
      ].join("\n"),
      ctaButton: {
        label: "View in Crew Hub",
        url: `${appUrl}/compliance`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `Compliance reminder: ${requirement}`,
      html
    });
  } catch (error) {
    console.error("Unexpected compliance reminder email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 17. Compliance Overdue (DORMANT)
 * -------------------------------------------------------------------------*/

export async function sendComplianceOverdueEmail({
  orgId,
  userId,
  requirement,
  dueDate,
  ownerName
}: {
  orgId: string;
  userId: string;
  requirement: string;
  dueDate?: string;
  ownerName?: string;
}): Promise<void> {
  try {
    if (!isEmailEnabled("complianceOverdue")) return;

    const owner = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const appUrl = resolveAppUrl();
    const resolvedOwner = ownerName || owner?.fullName || "a team member";

    if (owner) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const name = firstName(owner.fullName);

        const infoRows: Array<{ label: string; value: string }> = [
          { label: "Requirement", value: requirement }
        ];
        if (dueDate) {
          infoRows.push({ label: "Was due", value: dueDate });
        }
        infoRows.push({ label: "Assigned to", value: resolvedOwner });

        const html = renderEmailTemplate({
          preheaderText: "Immediate action required",
          greeting: `Hey ${name},`,
          bodyHtml: [
            p("A compliance requirement is now overdue."),
            renderInfoBlock(infoRows),
            pLast(
              "This needs immediate attention. Please follow up directly."
            )
          ].join("\n"),
          ctaButton: {
            label: "View in Crew Hub",
            url: `${appUrl}/compliance`,
            style: "cta"
          }
        });

        await sendResendEmail({
          to: [owner.email],
          subject: `Compliance overdue: ${requirement}`,
          html
        });
      }
    }

    if (hrEmails.length > 0) {
      const infoRows: Array<{ label: string; value: string }> = [
        { label: "Requirement", value: requirement }
      ];
      if (dueDate) {
        infoRows.push({ label: "Was due", value: dueDate });
      }
      infoRows.push({ label: "Assigned to", value: resolvedOwner });

      const html = renderEmailTemplate({
        preheaderText: "Immediate action required",
        greeting: "Hey there,",
        bodyHtml: [
          p("A compliance requirement is now overdue."),
          renderInfoBlock(infoRows),
          pLast(
            "This needs immediate attention. Please follow up directly."
          )
        ].join("\n"),
        ctaButton: {
          label: "View in Crew Hub",
          url: `${appUrl}/compliance`,
          style: "cta"
        }
      });

      await sendResendEmail({
        to: hrEmails,
        subject: `Compliance overdue: ${requirement}`,
        html
      });
    }
  } catch (error) {
    console.error("Unexpected compliance overdue email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 18. Review Cycle Started (DORMANT)
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
    if (!isEmailEnabled("reviewCycleStarted")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const bodyParts = [
      p(`The ${cycleName} review cycle is now open.`)
    ];
    if (selfReviewDeadline) {
      bodyParts.push(
        renderInfoBlock([
          { label: "Self-review deadline", value: selfReviewDeadline }
        ])
      );
    }

    const html = renderEmailTemplate({
      preheaderText: "Time to complete your self-review",
      greeting: `Hey ${name},`,
      bodyHtml: bodyParts.join("\n"),
      ctaButton: {
        label: "Start Your Review",
        url: `${appUrl}/performance`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `${cycleName} review has started`,
      html
    });
  } catch (error) {
    console.error("Unexpected review cycle started email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 19. Self-Review Reminder (DORMANT)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("selfReviewReminder")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: `Deadline is ${deadline}`,
      greeting: `Hey ${name},`,
      bodyHtml: [
        pLast(
          `Your self-review for ${cycleName} is due on ${deadline}. Please make sure it's submitted on time.`
        )
      ].join("\n"),
      ctaButton: {
        label: "Complete Self-Review",
        url: `${appUrl}/performance`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `Reminder: self-review due soon for ${cycleName}`,
      html
    });
  } catch (error) {
    console.error("Unexpected review reminder email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 20. Review Shared (DORMANT)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("reviewShared")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "Your manager shared your review",
      greeting: `Hey ${name},`,
      bodyHtml: [
        pLast(
          `Your review for ${cycleName} has been shared with you. Take a look when you have a moment.`
        )
      ].join("\n"),
      ctaButton: {
        label: "View Your Review",
        url: `${appUrl}/performance`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `Your ${cycleName} review has been shared`,
      html
    });
  } catch (error) {
    console.error("Unexpected review shared email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 21. Review Acknowledged (DORMANT)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("reviewAcknowledged")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "Review acknowledged",
      greeting: `Hey ${name},`,
      bodyHtml: [
        pLast(
          `${employeeName} has acknowledged their ${cycleName} review. No action needed on your end.`
        )
      ].join("\n"),
      ctaButton: {
        label: "View in Crew Hub",
        url: `${appUrl}/performance`,
        style: "primary"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `${employeeName} acknowledged their ${cycleName} review`,
      html
    });
  } catch (error) {
    console.error("Unexpected review acknowledged email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 22. Document Expiring Soon (DORMANT)
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
    if (!isEmailEnabled("documentExpiring")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "Document expiring soon",
      greeting: `Hey ${name},`,
      bodyHtml: [
        p("A document is expiring soon."),
        renderInfoBlock([
          { label: "Document", value: documentTitle },
          { label: "Expiry date", value: expiryDate }
        ]),
        pLast(
          "Please review and take any necessary action before it expires."
        )
      ].join("\n"),
      ctaButton: {
        label: "View Document",
        url: `${appUrl}/documents`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `${documentTitle} expires on ${expiryDate}`,
      html
    });
  } catch (error) {
    console.error("Unexpected document expiry email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 23. Document Expired (DORMANT)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("documentExpired")) return;

    const employee = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const appUrl = resolveAppUrl();

    if (employee) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const name = firstName(employee.fullName);

        const html = renderEmailTemplate({
          preheaderText: "Action needed",
          greeting: `Hey ${name},`,
          bodyHtml: [
            p("The following document has expired:"),
            renderInfoBlock([{ label: "Document", value: documentTitle }]),
            pLast(
              "Please upload a renewed version or take the appropriate next steps."
            )
          ].join("\n"),
          ctaButton: {
            label: "View in Crew Hub",
            url: `${appUrl}/documents`,
            style: "cta"
          }
        });

        await sendResendEmail({
          to: [employee.email],
          subject: `${documentTitle} has expired`,
          html
        });
      }
    }

    if (hrEmails.length > 0) {
      const html = renderEmailTemplate({
        preheaderText: "Action needed",
        greeting: "Hey there,",
        bodyHtml: [
          p("The following document has expired:"),
          renderInfoBlock([
            { label: "Document", value: documentTitle },
            {
              label: "Employee",
              value: employee?.fullName || "A team member"
            }
          ]),
          pLast(
            "Please upload a renewed version or take the appropriate next steps."
          )
        ].join("\n"),
        ctaButton: {
          label: "View in Crew Hub",
          url: `${appUrl}/documents`,
          style: "cta"
        }
      });

      await sendResendEmail({
        to: hrEmails,
        subject: `${documentTitle} has expired`,
        html
      });
    }
  } catch (error) {
    console.error("Unexpected document expired email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 24 & 25. Onboarding Started (ACTIVE) - to Employee + Manager
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
    if (!isEmailEnabled("onboardingStarted")) return;

    const [employee, manager] = await Promise.all([
      fetchRecipientProfile({ orgId, userId }),
      fetchRecipientProfile({ orgId, userId: managerId })
    ]);
    const appUrl = resolveAppUrl();

    // Template 24: to Employee
    if (employee) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const name = firstName(employee.fullName);
        const html = renderEmailTemplate({
          preheaderText: "Let's get you set up",
          greeting: `Hey ${name},`,
          bodyHtml: [
            pLast(
              "Welcome to the team. Your onboarding checklist is ready in Crew Hub. It has everything you need to get started: documents to sign, info to fill in, and tasks to complete."
            )
          ].join("\n"),
          ctaButton: {
            label: "Start Onboarding",
            url: `${appUrl}/onboarding`,
            style: "cta"
          },
          closingText:
            "If you have questions along the way, reach out to your manager or the Operations team."
        });

        await sendResendEmail({
          to: [employee.email],
          subject: `Welcome aboard, ${firstName(employee.fullName)}`,
          html
        });
      }
    }

    // Template 25: to Manager
    if (manager) {
      const canSend = await checkEmailPreference(
        orgId,
        managerId,
        "announcements"
      );
      if (canSend) {
        const managerFirst = firstName(manager.fullName);
        const html = renderEmailTemplate({
          preheaderText: "Their checklist is live",
          greeting: `Hey ${managerFirst},`,
          bodyHtml: [
            pLast(
              `${employeeName}'s onboarding has started. Their checklist is live in Crew Hub. You may have tasks assigned to you as part of their setup.`
            )
          ].join("\n"),
          ctaButton: {
            label: "View Onboarding",
            url: `${appUrl}/onboarding`,
            style: "cta"
          }
        });

        await sendResendEmail({
          to: [manager.email],
          subject: `Onboarding started for ${employeeName}`,
          html
        });
      }
    }
  } catch (error) {
    console.error("Unexpected onboarding started email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 26. Onboarding Overdue Reminder (DORMANT)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("onboardingOverdue")) return;

    const employee = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const appUrl = resolveAppUrl();

    if (employee) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const name = firstName(employee.fullName);
        const html = renderEmailTemplate({
          preheaderText: "Follow up needed",
          greeting: `Hey ${name},`,
          bodyHtml: [
            pLast(
              `Your onboarding task "${taskName}" is overdue. Please complete it as soon as possible.`
            )
          ].join("\n"),
          ctaButton: {
            label: "Complete Task",
            url: `${appUrl}/onboarding`,
            style: "cta"
          },
          closingText:
            "If you're stuck or need help, reach out to the Operations team."
        });

        await sendResendEmail({
          to: [employee.email],
          subject: `Onboarding task overdue: ${taskName}`,
          html
        });
      }
    }

    if (hrEmails.length > 0) {
      const html = renderEmailTemplate({
        preheaderText: "Follow up needed",
        greeting: "Hey there,",
        bodyHtml: [
          pLast(
            `The onboarding task "${taskName}" for ${employee?.fullName || "a new team member"} is overdue and may need follow-up.`
          )
        ].join("\n"),
        ctaButton: {
          label: "View in Crew Hub",
          url: `${appUrl}/onboarding`,
          style: "cta"
        }
      });

      await sendResendEmail({
        to: hrEmails,
        subject: `Onboarding task overdue: ${taskName}`,
        html
      });
    }
  } catch (error) {
    console.error("Unexpected onboarding task overdue email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 27 & 28. Onboarding Completed (DORMANT)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("onboardingCompleted")) return;

    const [employee, manager] = await Promise.all([
      fetchRecipientProfile({ orgId, userId }),
      fetchRecipientProfile({ orgId, userId: managerId })
    ]);
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const appUrl = resolveAppUrl();

    // Template 27: to Employee
    if (employee) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const name = firstName(employee.fullName);
        const html = renderEmailTemplate({
          preheaderText: "You're all set",
          greeting: `Hey ${name},`,
          bodyHtml: [
            pLast(
              "You've completed your onboarding. Everything is in order. Welcome to the team, for real this time."
            )
          ].join("\n"),
          ctaButton: {
            label: "View in Crew Hub",
            url: appUrl,
            style: "primary"
          }
        });

        await sendResendEmail({
          to: [employee.email],
          subject: "Onboarding complete!",
          html
        });
      }
    }

    // Template 28: to Manager + admins
    const notifyEmails: string[] = [
      ...(manager ? [manager.email] : []),
      ...hrEmails
    ];

    if (notifyEmails.length > 0) {
      const html = renderEmailTemplate({
        preheaderText: "All tasks done",
        greeting: "Hey there,",
        bodyHtml: [
          p(
            `${employeeName} has completed all onboarding tasks. No action needed on your end.`
          )
        ].join("\n")
      });

      await sendResendEmail({
        to: notifyEmails,
        subject: `${employeeName} completed onboarding`,
        html
      });
    }
  } catch (error) {
    console.error("Unexpected onboarding complete email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 29. Schedule Published (ACTIVE)
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
    if (!isEmailEnabled("schedulePublished")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const name = firstName(recipient.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: "Check your shifts",
      greeting: `Hey ${name},`,
      bodyHtml: [
        pLast(
          `The ${scheduleName} schedule for ${month} ${year} has been published. Check your assigned shifts in Crew Hub.`
        )
      ].join("\n"),
      ctaButton: {
        label: "View Schedule",
        url: `${appUrl}/scheduling`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: `${scheduleName} schedule published for ${month} ${year}`,
      html
    });
  } catch (error) {
    console.error("Unexpected schedule published email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 30. Swap Requested (ACTIVE)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("swapRequested")) return;

    const target = await fetchRecipientProfile({
      orgId,
      userId: targetUserId
    });
    if (!target) return;

    const canSend = await checkEmailPreference(
      orgId,
      targetUserId,
      "approvals"
    );
    if (!canSend) return;

    const name = firstName(target.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: `${requesterName} wants to swap a shift with you`,
      greeting: `Hey ${name},`,
      bodyHtml: [
        p(`${requesterName} has requested to swap a shift with you.`),
        renderInfoBlock([{ label: "Shift date", value: shiftDate }])
      ].join("\n"),
      ctaButton: {
        label: "Review Swap",
        url: `${appUrl}/scheduling`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [target.email],
      subject: `Shift swap request from ${requesterName}`,
      html
    });
  } catch (error) {
    console.error("Unexpected swap requested email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 31. Swap Accepted (ACTIVE)
 * -------------------------------------------------------------------------*/

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
    if (!isEmailEnabled("swapAccepted")) return;

    const requester = await fetchRecipientProfile({
      orgId,
      userId: requesterId
    });
    if (!requester) return;

    const canSend = await checkEmailPreference(
      orgId,
      requesterId,
      "approvals"
    );
    if (!canSend) return;

    const name = firstName(requester.fullName);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: `${targetName} accepted your swap`,
      greeting: `Hey ${name},`,
      bodyHtml: [
        p(`${targetName} accepted your shift swap request.`),
        renderInfoBlock([{ label: "Shift date", value: shiftDate }]),
        pLast("The schedule has been updated.")
      ].join("\n"),
      ctaButton: {
        label: "View Schedule",
        url: `${appUrl}/scheduling`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: [requester.email],
      subject: "Your shift swap was accepted",
      html
    });
  } catch (error) {
    console.error("Unexpected swap accepted email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 32. Payroll Final Approval (ACTIVE)
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
    if (!isEmailEnabled("payrollApproval")) return;

    const financeEmails = await fetchEmailsByRole({
      orgId,
      role: "FINANCE_ADMIN"
    });
    const adminEmails = await fetchEmailsByRole({
      orgId,
      role: "SUPER_ADMIN"
    });
    const approver = await fetchRecipientProfile({ orgId, userId });
    const appUrl = resolveAppUrl();

    const notifyEmails = [...new Set([...financeEmails, ...adminEmails])];
    if (notifyEmails.length === 0) return;

    const approverName = approver?.fullName || "an admin";

    const html = renderEmailTemplate({
      preheaderText: "Ready for processing",
      greeting: "Hey there,",
      bodyHtml: [
        pLast(
          `The payroll run "${runName}" has been approved by ${approverName} and is ready for processing.`
        )
      ].join("\n"),
      ctaButton: {
        label: "View Payroll Run",
        url: `${appUrl}/payroll`,
        style: "cta"
      }
    });

    await sendResendEmail({
      to: notifyEmails,
      subject: `Payroll run approved: ${runName}`,
      html
    });
  } catch (error) {
    console.error("Unexpected payroll approved email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/* ---------------------------------------------------------------------------
 * 33. Password/MFA Reset (ACTIVE, auth - always sends)
 * -------------------------------------------------------------------------*/

export async function sendResetEmail({
  recipientEmail,
  recipientName,
  resetLink
}: {
  recipientEmail: string;
  recipientName: string;
  resetLink: string;
}): Promise<void> {
  try {
    const name = firstName(recipientName);

    const html = renderEmailTemplate({
      preheaderText: "Set up a new authenticator",
      greeting: `Hey ${name},`,
      bodyHtml: [
        pLast(
          "A login reset was requested for your Crew Hub account. Tap below to set up a new authenticator:"
        )
      ].join("\n"),
      ctaButton: {
        label: "Reset Login",
        url: resetLink,
        style: "cta"
      },
      closingText:
        "If you didn't request this, reach out to the Operations team."
    });

    await sendResendEmail({
      to: [recipientEmail],
      subject: "Reset your Crew Hub login",
      html
    });
  } catch (error) {
    console.error("Unexpected reset email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
