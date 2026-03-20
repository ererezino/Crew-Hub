import "server-only";

import { methodLabel } from "../payment-details";
import type { PaymentMethod } from "../../types/payment-details";
import { sendPaymentDetailsUpdatedEmail } from "./email";

/**
 * Notify finance staff when an employee updates their payment details.
 * Delegates to the branded email template via sendPaymentDetailsUpdatedEmail.
 */
export async function notifyPaymentDetailsChanged({
  orgId,
  employeeId,
  employeeName,
  employeeEmail,
  paymentMethod,
  changeEffectiveAt
}: {
  orgId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  paymentMethod: PaymentMethod;
  changeEffectiveAt: string;
}): Promise<void> {
  try {
    await sendPaymentDetailsUpdatedEmail({
      orgId,
      employeeId,
      employeeName,
      employeeEmail,
      paymentMethod: methodLabel(paymentMethod),
      changeEffectiveAt: new Date(changeEffectiveAt).toLocaleString()
    });
  } catch (error) {
    console.error("Unexpected payment detail notification failure.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
