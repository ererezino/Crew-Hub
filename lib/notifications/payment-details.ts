import "server-only";

import { methodLabel } from "../payment-details";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import type { PaymentMethod } from "../../types/payment-details";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function shouldNotifyRole(roles: readonly string[]): boolean {
  return roles.includes("HR_ADMIN") || roles.includes("SUPER_ADMIN");
}

export async function notifyHrPaymentDetailsChanged({
  orgId,
  employeeName,
  employeeEmail,
  paymentMethod,
  changeEffectiveAt
}: {
  orgId: string;
  employeeName: string;
  employeeEmail: string;
  paymentMethod: PaymentMethod;
  changeEffectiveAt: string;
}): Promise<void> {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      return;
    }

    const serviceRoleClient = createSupabaseServiceRoleClient();

    const { data: profileRows, error: profilesError } = await serviceRoleClient
      .from("profiles")
      .select("email, full_name, roles")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (profilesError || !profileRows) {
      console.error("Unable to load HR recipients for payment detail notifications.", {
        message: profilesError?.message ?? "unknown"
      });
      return;
    }

    const recipients = profileRows
      .filter((row) => {
        const rowRoles = Array.isArray(row.roles)
          ? row.roles.filter((role): role is string => typeof role === "string")
          : [];

        return shouldNotifyRole(rowRoles);
      })
      .map((row) => row.email)
      .filter((email): email is string => typeof email === "string" && email.length > 0);

    if (recipients.length === 0) {
      return;
    }

    const uniqueRecipients = [...new Set(recipients)];

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Crew Hub <no-reply@crew-hub.local>",
        to: uniqueRecipients,
        subject: `Crew Hub payment details updated for ${employeeName}`,
        text: [
          "Crew Hub payment details update notice",
          "",
          `${employeeName} (${employeeEmail}) updated payment details.`,
          `Method: ${methodLabel(paymentMethod)}`,
          `Change effective at: ${new Date(changeEffectiveAt).toLocaleString()}`,
          "",
          "Review masked details in Crew Hub Admin > Payment Details."
        ].join("\n")
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to send HR payment detail notification email.", {
        status: response.status,
        body: errorText
      });
    }
  } catch (error) {
    console.error("Unexpected payment detail notification failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
