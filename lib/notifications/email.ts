import "server-only";

import { createTranslator } from "use-intl/core";
import type { AppLocale } from "@/types/locale";
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

import enMessages from "@/messages/en.json";
import frMessages from "@/messages/fr.json";

const allMessages = { en: enMessages, fr: frMessages } as const;

function resolveLocale(preferred?: string | null): AppLocale {
  return preferred === "fr" ? "fr" : "en";
}

function createEmailTranslator(locale: AppLocale) {
  return createTranslator({
    locale,
    messages: allMessages[locale],
    namespace: "email"
  });
}

/** Returns the translated footer + tagline for renderEmailTemplate */
function emailLocaleOptions(t: ReturnType<typeof createEmailTranslator>, locale: AppLocale) {
  const td = t as (key: string) => string;
  return {
    lang: locale,
    footerOverride: td("footer.default").replace(/\n/g, "<br>"),
    tagline: td("footer.tagline")
  };
}

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
  locale: AppLocale;
};

type SuspendedEmailFlow =
  | "paymentDetailsUpdated"
  | "performanceReview"
  | "complianceReminder"
  | "documentExpiry"
  | "shiftSwap";

// Temporarily paused by product request to preserve quota for critical flows.
const SUSPENDED_EMAIL_FLOWS = new Set<SuspendedEmailFlow>([
  "paymentDetailsUpdated",
  "performanceReview",
  "complianceReminder",
  "documentExpiry",
  "shiftSwap"
]);

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
    .select("email, full_name, preferred_locale")
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
    fullName: typeof row.full_name === "string" ? row.full_name : "Crew member",
    locale: resolveLocale(row.preferred_locale as string | null)
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

function firstName(fullName: string, locale: AppLocale = "en"): string {
  const name = fullName.trim().split(/\s+/)[0];
  if (name) return name;
  const t = createEmailTranslator(locale);
  return t("fallbackName");
}

function isEmailFlowSuspended(flow: SuspendedEmailFlow): boolean {
  return SUSPENDED_EMAIL_FLOWS.has(flow);
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
  isNewHire = true,
  locale = "en" as AppLocale
}: {
  recipientEmail: string;
  recipientName: string;
  setupLink?: string;
  department?: string;
  managerName?: string;
  isNewHire?: boolean;
  locale?: AppLocale;
}): Promise<void> {
  try {
    const t = createEmailTranslator(locale);
    const name = firstName(recipientName, locale);
    const appUrl = resolveAppUrl();
    const effectiveSetupLink = setupLink || `${appUrl}/login`;

    if (isNewHire) {
      // Template 1: New Hire Welcome
      const infoRows: Array<{ label: string; value: string }> = [
        { label: t("welcome.newHire.loginEmail"), value: recipientEmail }
      ];
      if (department) {
        infoRows.push({ label: t("welcome.newHire.yourTeam"), value: department });
      }
      if (managerName) {
        infoRows.push({ label: t("welcome.newHire.yourManager"), value: managerName });
      }

      const html = renderEmailTemplate({
        preheaderText: t("welcome.newHire.preheader"),
        greeting: t("greeting", { name }),
        bodyHtml: [
          p(t("welcome.newHire.body1")),
          p(t("welcome.newHire.body2")),
          pLast(t("welcome.newHire.body3")),
          renderInfoBlock(infoRows)
        ].join("\n"),
        ctaButton: {
          label: t("welcome.newHire.cta"),
          url: effectiveSetupLink,
          style: "cta"
        },
        closingText: t("welcome.newHire.closing"),
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: [recipientEmail],
        subject: t("welcome.newHire.subject", { name }),
        html
      });
    } else {
      // Template 2: Existing Employee Invite
      const html = renderEmailTemplate({
        preheaderText: t("welcome.invite.preheader"),
        greeting: t("greeting", { name }),
        bodyHtml: [
          p(t("welcome.invite.body1")),
          pLast(t("welcome.invite.body2")),
          renderInfoBlock([{ label: t("welcome.invite.loginEmail"), value: recipientEmail }])
        ].join("\n"),
        ctaButton: {
          label: t("welcome.invite.cta"),
          url: effectiveSetupLink,
          style: "cta"
        },
        closingText: t("welcome.invite.closing"),
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: [recipientEmail],
        subject: t("welcome.invite.subject"),
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

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();
    const dateRange = formatDateRangeHuman(startDate, endDate, locale);
    const resolvedApprover = approverName || t("fallbackApprover");

    if (status === "approved") {
      const infoRows = [
        { label: t("leave.approved.type"), value: formatLeaveTypeLabel(leaveType, locale) },
        { label: t("leave.approved.dates"), value: dateRange },
        { label: t("leave.approved.approvedBy"), value: resolvedApprover }
      ];

      const html = renderEmailTemplate({
        preheaderText: t("leave.approved.preheader"),
        greeting: t("greeting", { name }),
        bodyHtml: [
          p(t("leave.approved.body")),
          renderInfoBlock(infoRows),
          pLast(t("leave.approved.closing"))
        ].join("\n"),
        ctaButton: {
          label: t("leave.approved.cta"),
          url: `${appUrl}/time-off`,
          style: "cta"
        },
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: [recipient.email],
        subject: t("leave.approved.subject"),
        html
      });
    } else {
      const infoRows = [
        { label: t("leave.rejected.type"), value: formatLeaveTypeLabel(leaveType, locale) },
        { label: t("leave.rejected.dates"), value: dateRange },
        { label: t("leave.rejected.reviewedBy"), value: resolvedApprover }
      ];
      if (rejectionReason?.trim()) {
        infoRows.push({ label: t("leave.rejected.reason"), value: rejectionReason.trim() });
      }

      const html = renderEmailTemplate({
        preheaderText: t("leave.rejected.preheader"),
        greeting: t("greeting", { name }),
        bodyHtml: [
          p(t("leave.rejected.body")),
          renderInfoBlock(infoRows),
          pLast(t("leave.rejected.closing", { approver: resolvedApprover }))
        ].join("\n"),
        ctaButton: {
          label: t("leave.rejected.cta"),
          url: `${appUrl}/time-off`,
          style: "primary"
        },
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: [recipient.email],
        subject: t("leave.rejected.subject"),
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

    const locale = manager.locale;
    const t = createEmailTranslator(locale);
    const managerFirst = firstName(manager.fullName, locale);
    const appUrl = resolveAppUrl();
    const dateRange = formatDateRangeHuman(startDate, endDate, locale);

    const infoRows: Array<{ label: string; value: string }> = [
      { label: t("leave.requested.type"), value: formatLeaveTypeLabel(leaveType, locale) },
      { label: t("leave.requested.dates"), value: dateRange }
    ];
    if (note?.trim()) {
      infoRows.push({ label: t("leave.requested.note"), value: note.trim() });
    }

    const html = renderEmailTemplate({
      preheaderText: t("leave.requested.preheader"),
      greeting: t("greeting", { name: managerFirst }),
      bodyHtml: [
        p(t("leave.requested.body", { employeeName })),
        renderInfoBlock(infoRows)
      ].join("\n"),
      ctaButton: {
        label: t("leave.requested.cta"),
        url: `${appUrl}/time-off`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [manager.email],
      subject: t("leave.requested.subject", { employeeName }),
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

    const locale = manager.locale;
    const t = createEmailTranslator(locale);
    const managerFirst = firstName(manager.fullName, locale);
    const dateRange = formatDateRangeHuman(startDate, endDate, locale);

    const html = renderEmailTemplate({
      preheaderText: t("leave.cancelled.preheader"),
      greeting: t("greeting", { name: managerFirst }),
      bodyHtml: [
        p(t("leave.cancelled.body", { employeeName })),
        renderInfoBlock([
          { label: t("leave.cancelled.type"), value: formatLeaveTypeLabel(leaveType, locale) },
          { label: t("leave.cancelled.dates"), value: dateRange }
        ]),
        p(t("leave.cancelled.noAction"))
      ].join("\n"),
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [manager.email],
      subject: t("leave.cancelled.subject", { employeeName }),
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

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("payslip.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        pLast(t("payslip.body", { payPeriod }))
      ].join("\n"),
      ctaButton: {
        label: t("payslip.cta"),
        url: `${appUrl}/payments`,
        style: "cta"
      },
      closingText: t("payslip.closing"),
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("payslip.subject", { payPeriod }),
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
        const locale = employee.locale;
        const t = createEmailTranslator(locale);
        const name = firstName(employee.fullName, locale);
        const html = renderEmailTemplate({
          preheaderText: t("expense.submitted.employee.preheader"),
          greeting: t("greeting", { name }),
          bodyHtml: [
            p(t("expense.submitted.employee.body")),
            renderInfoBlock([
              { label: t("expense.submitted.employee.expense"), value: description },
              { label: t("expense.submitted.employee.amount"), value: amount }
            ]),
            pLast(t("expense.submitted.employee.closing"))
          ].join("\n"),
          ctaButton: {
            label: t("expense.submitted.employee.cta"),
            url: `${appUrl}/expenses`,
            style: "cta"
          },
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [employee.email],
          subject: t("expense.submitted.employee.subject"),
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
        const locale = manager.locale;
        const t = createEmailTranslator(locale);
        const managerFirst = firstName(manager.fullName, locale);
        const employeeFallback = employee?.fullName || t("fallbackEmployee");
        const html = renderEmailTemplate({
          preheaderText: t("expense.submitted.manager.preheader"),
          greeting: t("greeting", { name: managerFirst }),
          bodyHtml: [
            p(t("expense.submitted.manager.body", { employeeName: employeeFallback })),
            renderInfoBlock([
              { label: t("expense.submitted.manager.expense"), value: description },
              { label: t("expense.submitted.manager.amount"), value: amount }
            ])
          ].join("\n"),
          ctaButton: {
            label: t("expense.submitted.manager.cta"),
            url: `${appUrl}/expenses`,
            style: "cta"
          },
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [manager.email],
          subject: t("expense.submitted.manager.subject", { employeeName: employeeFallback }),
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

    // Template 10: to Employee
    if (employee) {
      const canSend = await checkEmailPreference(orgId, userId, "approvals");
      if (canSend) {
        const locale = employee.locale;
        const t = createEmailTranslator(locale);
        const name = firstName(employee.fullName, locale);
        const resolvedApprover = approverName || t("fallbackApprover");
        const html = renderEmailTemplate({
          preheaderText: t("expense.approved.employee.preheader"),
          greeting: t("greeting", { name }),
          bodyHtml: [
            p(t("expense.approved.employee.body")),
            renderInfoBlock([
              { label: t("expense.approved.employee.expense"), value: description },
              { label: t("expense.approved.employee.amount"), value: amount },
              { label: t("expense.approved.employee.approvedBy"), value: resolvedApprover }
            ])
          ].join("\n"),
          ctaButton: {
            label: t("expense.approved.employee.cta"),
            url: `${appUrl}/expenses`,
            style: "cta"
          },
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [employee.email],
          subject: t("expense.approved.employee.subject"),
          html
        });
      }
    }

    // Template 11: to Finance (role-based, default to "en")
    if (financeEmails.length > 0) {
      const locale: AppLocale = "en";
      const t = createEmailTranslator(locale);
      const employeeFallback = employee?.fullName || t("fallbackEmployee");
      const resolvedApprover = approverName || t("fallbackApprover");
      const html = renderEmailTemplate({
        preheaderText: t("expense.approved.finance.preheader", { amount, employeeName: employeeFallback }),
        greeting: t("greetingGeneric"),
        bodyHtml: [
          p(t("expense.approved.finance.body")),
          renderInfoBlock([
            {
              label: t("expense.approved.finance.employee"),
              value: employeeFallback
            },
            { label: t("expense.approved.finance.expense"), value: description },
            { label: t("expense.approved.finance.amount"), value: amount },
            { label: t("expense.approved.finance.approvedBy"), value: resolvedApprover }
          ])
        ].join("\n"),
        ctaButton: {
          label: t("expense.approved.finance.cta"),
          url: `${appUrl}/expenses`,
          style: "cta"
        },
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: financeEmails,
        subject: t("expense.approved.finance.subject", { description }),
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

    const locale = employee.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(employee.fullName, locale);
    const appUrl = resolveAppUrl();
    const resolvedApprover = approverName || t("fallbackApprover");

    const infoRows = [
      { label: t("expense.rejected.expense"), value: description },
      { label: t("expense.rejected.amount"), value: amount },
      { label: t("expense.rejected.reviewedBy"), value: resolvedApprover }
    ];
    if (reason?.trim()) {
      infoRows.push({ label: t("expense.rejected.reason"), value: reason.trim() });
    }

    const html = renderEmailTemplate({
      preheaderText: t("expense.rejected.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("expense.rejected.body")),
        renderInfoBlock(infoRows),
        pLast(t("expense.rejected.closing", { approver: resolvedApprover }))
      ].join("\n"),
      ctaButton: {
        label: t("expense.rejected.cta"),
        url: `${appUrl}/expenses`,
        style: "primary"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [employee.email],
      subject: t("expense.rejected.subject"),
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

    const locale = employee.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(employee.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("expense.disbursed.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("expense.disbursed.body")),
        renderInfoBlock([
          { label: t("expense.disbursed.expense"), value: description },
          { label: t("expense.disbursed.amount"), value: amount }
        ]),
        pLast(t("expense.disbursed.closing"))
      ].join("\n"),
      ctaButton: {
        label: t("expense.disbursed.cta"),
        url: `${appUrl}/expenses`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [employee.email],
      subject: t("expense.disbursed.subject"),
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

    const locale = employee.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(employee.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("expense.infoRequested.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("expense.infoRequested.body", { requesterName })),
        renderInfoBlock([
          { label: t("expense.infoRequested.expense"), value: description },
          { label: t("expense.infoRequested.request"), value: message }
        ])
      ].join("\n"),
      ctaButton: {
        label: t("expense.infoRequested.cta"),
        url: `${appUrl}/expenses`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [employee.email],
      subject: t("expense.infoRequested.subject"),
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

    const locale = reviewer.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(reviewer.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("expense.infoResponse.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("expense.infoResponse.body", { responderName })),
        renderInfoBlock([
          { label: t("expense.infoResponse.expense"), value: description },
          { label: t("expense.infoResponse.response"), value: message }
        ])
      ].join("\n"),
      ctaButton: {
        label: t("expense.infoResponse.cta"),
        url: `${appUrl}/expenses/approvals`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [reviewer.email],
      subject: t("expense.infoResponse.subject"),
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

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("signature.preheader", { requestedByName }),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("signature.body", { requestedByName })),
        renderInfoBlock([{ label: t("signature.document"), value: requestTitle }])
      ].join("\n"),
      ctaButton: {
        label: t("signature.cta"),
        url: signatureUrl || `${appUrl}/signatures`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("signature.subject", { requestTitle }),
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
    if (isEmailFlowSuspended("paymentDetailsUpdated")) return;
    if (!isEmailEnabled("paymentDetailsUpdated")) return;

    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const adminEmails = await fetchEmailsByRole({ orgId, role: "SUPER_ADMIN" });
    const recipients = [...new Set([...hrEmails, ...adminEmails])];

    if (recipients.length === 0) return;

    // Role-based email, default to "en"
    const locale: AppLocale = "en";
    const t = createEmailTranslator(locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("paymentDetails.preheader"),
      greeting: t("greetingGeneric"),
      bodyHtml: [
        p(t("paymentDetails.body", { employeeName, employeeEmail })),
        renderInfoBlock([
          { label: t("paymentDetails.paymentMethod"), value: paymentMethod },
          { label: t("paymentDetails.effective"), value: changeEffectiveAt }
        ]),
        pLast(t("paymentDetails.closing"))
      ].join("\n"),
      ctaButton: {
        label: t("paymentDetails.cta"),
        url: `${appUrl}/people`,
        style: "primary"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: recipients,
      subject: t("paymentDetails.subject", { employeeName }),
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
    if (isEmailFlowSuspended("complianceReminder")) return;
    if (!isEmailEnabled("complianceReminder")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("compliance.reminder.preheader", { dueDate }),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("compliance.reminder.body")),
        renderInfoBlock([
          { label: t("compliance.reminder.requirement"), value: requirement },
          { label: t("compliance.reminder.dueDate"), value: dueDate }
        ]),
        pLast(t("compliance.reminder.closing"))
      ].join("\n"),
      ctaButton: {
        label: t("compliance.reminder.cta"),
        url: `${appUrl}/compliance`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("compliance.reminder.subject", { requirement }),
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
    if (isEmailFlowSuspended("complianceReminder")) return;
    if (!isEmailEnabled("complianceOverdue")) return;

    const owner = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const appUrl = resolveAppUrl();

    // Owner email (specific person)
    if (owner) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const locale = owner.locale;
        const t = createEmailTranslator(locale);
        const name = firstName(owner.fullName, locale);
        const resolvedOwner = ownerName || owner.fullName || t("fallbackEmployee");

        const infoRows: Array<{ label: string; value: string }> = [
          { label: t("compliance.overdue.requirement"), value: requirement }
        ];
        if (dueDate) {
          infoRows.push({ label: t("compliance.overdue.wasDue"), value: dueDate });
        }
        infoRows.push({ label: t("compliance.overdue.assignedTo"), value: resolvedOwner });

        const html = renderEmailTemplate({
          preheaderText: t("compliance.overdue.preheader"),
          greeting: t("greeting", { name }),
          bodyHtml: [
            p(t("compliance.overdue.body")),
            renderInfoBlock(infoRows),
            pLast(t("compliance.overdue.closing"))
          ].join("\n"),
          ctaButton: {
            label: t("compliance.overdue.cta"),
            url: `${appUrl}/compliance`,
            style: "cta"
          },
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [owner.email],
          subject: t("compliance.overdue.subject", { requirement }),
          html
        });
      }
    }

    // HR email (role-based, default to "en")
    if (hrEmails.length > 0) {
      const locale: AppLocale = "en";
      const t = createEmailTranslator(locale);
      const resolvedOwner = ownerName || owner?.fullName || t("fallbackEmployee");

      const infoRows: Array<{ label: string; value: string }> = [
        { label: t("compliance.overdue.requirement"), value: requirement }
      ];
      if (dueDate) {
        infoRows.push({ label: t("compliance.overdue.wasDue"), value: dueDate });
      }
      infoRows.push({ label: t("compliance.overdue.assignedTo"), value: resolvedOwner });

      const html = renderEmailTemplate({
        preheaderText: t("compliance.overdue.preheader"),
        greeting: t("greetingGeneric"),
        bodyHtml: [
          p(t("compliance.overdue.body")),
          renderInfoBlock(infoRows),
          pLast(t("compliance.overdue.closing"))
        ].join("\n"),
        ctaButton: {
          label: t("compliance.overdue.cta"),
          url: `${appUrl}/compliance`,
          style: "cta"
        },
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: hrEmails,
        subject: t("compliance.overdue.subject", { requirement }),
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
    if (isEmailFlowSuspended("performanceReview")) return;
    if (!isEmailEnabled("reviewCycleStarted")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const bodyParts = [
      p(t("review.cycleStarted.body", { cycleName }))
    ];
    if (selfReviewDeadline) {
      bodyParts.push(
        renderInfoBlock([
          { label: t("review.cycleStarted.selfReviewDeadline"), value: selfReviewDeadline }
        ])
      );
    }

    const html = renderEmailTemplate({
      preheaderText: t("review.cycleStarted.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: bodyParts.join("\n"),
      ctaButton: {
        label: t("review.cycleStarted.cta"),
        url: `${appUrl}/performance`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("review.cycleStarted.subject", { cycleName }),
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
    if (isEmailFlowSuspended("performanceReview")) return;
    if (!isEmailEnabled("selfReviewReminder")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("review.reminder.preheader", { deadline }),
      greeting: t("greeting", { name }),
      bodyHtml: [
        pLast(t("review.reminder.body", { cycleName, deadline }))
      ].join("\n"),
      ctaButton: {
        label: t("review.reminder.cta"),
        url: `${appUrl}/performance`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("review.reminder.subject", { cycleName }),
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
    if (isEmailFlowSuspended("performanceReview")) return;
    if (!isEmailEnabled("reviewShared")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("review.shared.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        pLast(t("review.shared.body", { cycleName }))
      ].join("\n"),
      ctaButton: {
        label: t("review.shared.cta"),
        url: `${appUrl}/performance`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("review.shared.subject", { cycleName }),
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
    if (isEmailFlowSuspended("performanceReview")) return;
    if (!isEmailEnabled("reviewAcknowledged")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("review.acknowledged.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        pLast(t("review.acknowledged.body", { employeeName, cycleName }))
      ].join("\n"),
      ctaButton: {
        label: t("review.acknowledged.cta"),
        url: `${appUrl}/performance`,
        style: "primary"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("review.acknowledged.subject", { employeeName, cycleName }),
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
    if (isEmailFlowSuspended("documentExpiry")) return;
    if (!isEmailEnabled("documentExpiring")) return;

    const recipient = await fetchRecipientProfile({ orgId, userId });
    if (!recipient) return;

    const canSend = await checkEmailPreference(
      orgId,
      userId,
      "announcements"
    );
    if (!canSend) return;

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("document.expiring.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("document.expiring.body")),
        renderInfoBlock([
          { label: t("document.expiring.document"), value: documentTitle },
          { label: t("document.expiring.expiryDate"), value: expiryDate }
        ]),
        pLast(t("document.expiring.closing"))
      ].join("\n"),
      ctaButton: {
        label: t("document.expiring.cta"),
        url: `${appUrl}/documents`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("document.expiring.subject", { documentTitle, expiryDate }),
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
    if (isEmailFlowSuspended("documentExpiry")) return;
    if (!isEmailEnabled("documentExpired")) return;

    const employee = await fetchRecipientProfile({ orgId, userId });
    const hrEmails = await fetchEmailsByRole({ orgId, role: "HR_ADMIN" });
    const appUrl = resolveAppUrl();

    // To employee (specific person)
    if (employee) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const locale = employee.locale;
        const t = createEmailTranslator(locale);
        const name = firstName(employee.fullName, locale);

        const html = renderEmailTemplate({
          preheaderText: t("document.expired.employee.preheader"),
          greeting: t("greeting", { name }),
          bodyHtml: [
            p(t("document.expired.employee.body")),
            renderInfoBlock([{ label: t("document.expired.employee.document"), value: documentTitle }]),
            pLast(t("document.expired.employee.closing"))
          ].join("\n"),
          ctaButton: {
            label: t("document.expired.employee.cta"),
            url: `${appUrl}/documents`,
            style: "cta"
          },
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [employee.email],
          subject: t("document.expired.employee.subject", { documentTitle }),
          html
        });
      }
    }

    // To HR (role-based, default to "en")
    if (hrEmails.length > 0) {
      const locale: AppLocale = "en";
      const t = createEmailTranslator(locale);

      const html = renderEmailTemplate({
        preheaderText: t("document.expired.hr.preheader"),
        greeting: t("greetingGeneric"),
        bodyHtml: [
          p(t("document.expired.hr.body")),
          renderInfoBlock([
            { label: t("document.expired.hr.document"), value: documentTitle },
            {
              label: t("document.expired.hr.employee"),
              value: employee?.fullName || t("fallbackEmployee")
            }
          ]),
          pLast(t("document.expired.hr.closing"))
        ].join("\n"),
        ctaButton: {
          label: t("document.expired.hr.cta"),
          url: `${appUrl}/documents`,
          style: "cta"
        },
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: hrEmails,
        subject: t("document.expired.hr.subject", { documentTitle }),
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
        const locale = employee.locale;
        const t = createEmailTranslator(locale);
        const name = firstName(employee.fullName, locale);
        const html = renderEmailTemplate({
          preheaderText: t("onboarding.started.employee.preheader"),
          greeting: t("greeting", { name }),
          bodyHtml: [
            pLast(t("onboarding.started.employee.body"))
          ].join("\n"),
          ctaButton: {
            label: t("onboarding.started.employee.cta"),
            url: `${appUrl}/onboarding`,
            style: "cta"
          },
          closingText: t("onboarding.started.employee.closing"),
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [employee.email],
          subject: t("onboarding.started.employee.subject", { name: firstName(employee.fullName, locale) }),
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
        const locale = manager.locale;
        const t = createEmailTranslator(locale);
        const managerFirst = firstName(manager.fullName, locale);
        const html = renderEmailTemplate({
          preheaderText: t("onboarding.started.manager.preheader"),
          greeting: t("greeting", { name: managerFirst }),
          bodyHtml: [
            pLast(t("onboarding.started.manager.body", { employeeName }))
          ].join("\n"),
          ctaButton: {
            label: t("onboarding.started.manager.cta"),
            url: `${appUrl}/onboarding`,
            style: "cta"
          },
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [manager.email],
          subject: t("onboarding.started.manager.subject", { employeeName }),
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

    // To employee (specific person)
    if (employee) {
      const canSend = await checkEmailPreference(
        orgId,
        userId,
        "announcements"
      );
      if (canSend) {
        const locale = employee.locale;
        const t = createEmailTranslator(locale);
        const name = firstName(employee.fullName, locale);
        const html = renderEmailTemplate({
          preheaderText: t("onboarding.overdue.employee.preheader"),
          greeting: t("greeting", { name }),
          bodyHtml: [
            pLast(t("onboarding.overdue.employee.body", { taskName }))
          ].join("\n"),
          ctaButton: {
            label: t("onboarding.overdue.employee.cta"),
            url: `${appUrl}/onboarding`,
            style: "cta"
          },
          closingText: t("onboarding.overdue.employee.closing"),
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [employee.email],
          subject: t("onboarding.overdue.employee.subject", { taskName }),
          html
        });
      }
    }

    // To HR (role-based, default to "en")
    if (hrEmails.length > 0) {
      const locale: AppLocale = "en";
      const t = createEmailTranslator(locale);

      const html = renderEmailTemplate({
        preheaderText: t("onboarding.overdue.hr.preheader"),
        greeting: t("greetingGeneric"),
        bodyHtml: [
          pLast(t("onboarding.overdue.hr.body", { taskName, employeeName: employee?.fullName || t("fallbackEmployee") }))
        ].join("\n"),
        ctaButton: {
          label: t("onboarding.overdue.hr.cta"),
          url: `${appUrl}/onboarding`,
          style: "cta"
        },
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: hrEmails,
        subject: t("onboarding.overdue.hr.subject", { taskName }),
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
        const locale = employee.locale;
        const t = createEmailTranslator(locale);
        const name = firstName(employee.fullName, locale);
        const html = renderEmailTemplate({
          preheaderText: t("onboarding.complete.employee.preheader"),
          greeting: t("greeting", { name }),
          bodyHtml: [
            pLast(t("onboarding.complete.employee.body"))
          ].join("\n"),
          ctaButton: {
            label: t("onboarding.complete.employee.cta"),
            url: appUrl,
            style: "primary"
          },
          ...emailLocaleOptions(t, locale)
        });

        await sendResendEmail({
          to: [employee.email],
          subject: t("onboarding.complete.employee.subject"),
          html
        });
      }
    }

    // Template 28: to Manager + admins (role-based, default to "en")
    const notifyEmails: string[] = [
      ...(manager ? [manager.email] : []),
      ...hrEmails
    ];

    if (notifyEmails.length > 0) {
      const locale: AppLocale = "en";
      const t = createEmailTranslator(locale);

      const html = renderEmailTemplate({
        preheaderText: t("onboarding.complete.manager.preheader"),
        greeting: t("greetingGeneric"),
        bodyHtml: [
          p(t("onboarding.complete.manager.body", { employeeName }))
        ].join("\n"),
        ...emailLocaleOptions(t, locale)
      });

      await sendResendEmail({
        to: notifyEmails,
        subject: t("onboarding.complete.manager.subject", { employeeName }),
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

    const locale = recipient.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(recipient.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("schedule.published.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        pLast(t("schedule.published.body", { scheduleName, month, year }))
      ].join("\n"),
      ctaButton: {
        label: t("schedule.published.cta"),
        url: `${appUrl}/scheduling`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipient.email],
      subject: t("schedule.published.subject", { scheduleName, month, year }),
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
    if (isEmailFlowSuspended("shiftSwap")) return;
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

    const locale = target.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(target.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("swap.requested.preheader", { requesterName }),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("swap.requested.body", { requesterName })),
        renderInfoBlock([{ label: t("swap.requested.shiftDate"), value: shiftDate }])
      ].join("\n"),
      ctaButton: {
        label: t("swap.requested.cta"),
        url: `${appUrl}/scheduling`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [target.email],
      subject: t("swap.requested.subject", { requesterName }),
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
    if (isEmailFlowSuspended("shiftSwap")) return;
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

    const locale = requester.locale;
    const t = createEmailTranslator(locale);
    const name = firstName(requester.fullName, locale);
    const appUrl = resolveAppUrl();

    const html = renderEmailTemplate({
      preheaderText: t("swap.accepted.preheader", { targetName }),
      greeting: t("greeting", { name }),
      bodyHtml: [
        p(t("swap.accepted.body", { targetName })),
        renderInfoBlock([{ label: t("swap.accepted.shiftDate"), value: shiftDate }]),
        pLast(t("swap.accepted.closing"))
      ].join("\n"),
      ctaButton: {
        label: t("swap.accepted.cta"),
        url: `${appUrl}/scheduling`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [requester.email],
      subject: t("swap.accepted.subject"),
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

    // Role-based email, default to "en"
    const locale: AppLocale = "en";
    const t = createEmailTranslator(locale);
    const approverName = approver?.fullName || t("fallbackApproverAdmin");

    const html = renderEmailTemplate({
      preheaderText: t("payroll.approved.preheader"),
      greeting: t("greetingGeneric"),
      bodyHtml: [
        pLast(t("payroll.approved.body", { runName, approverName }))
      ].join("\n"),
      ctaButton: {
        label: t("payroll.approved.cta"),
        url: `${appUrl}/payroll`,
        style: "cta"
      },
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: notifyEmails,
      subject: t("payroll.approved.subject", { runName }),
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
  resetLink,
  locale = "en" as AppLocale
}: {
  recipientEmail: string;
  recipientName: string;
  resetLink: string;
  locale?: AppLocale;
}): Promise<void> {
  try {
    const t = createEmailTranslator(locale);
    const name = firstName(recipientName, locale);

    const html = renderEmailTemplate({
      preheaderText: t("reset.preheader"),
      greeting: t("greeting", { name }),
      bodyHtml: [
        pLast(t("reset.body"))
      ].join("\n"),
      ctaButton: {
        label: t("reset.cta"),
        url: resetLink,
        style: "cta"
      },
      closingText: t("reset.closing"),
      ...emailLocaleOptions(t, locale)
    });

    await sendResendEmail({
      to: [recipientEmail],
      subject: t("reset.subject"),
      html
    });
  } catch (error) {
    console.error("Unexpected reset email failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
