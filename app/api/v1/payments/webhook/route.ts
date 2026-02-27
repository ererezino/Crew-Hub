import { z } from "zod";

import type { PaymentsWebhookResponseData } from "../../../../../types/payments";
import { buildMeta, jsonResponse } from "../_helpers";

const webhookPayloadSchema = z
  .object({
    eventType: z.string().trim().min(1).optional(),
    paymentId: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
    payload: z.unknown().optional()
  })
  .passthrough();

export async function POST(request: Request) {
  let payload: unknown = null;

  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const parsedPayload = webhookPayloadSchema.safeParse(payload);
  const eventType = parsedPayload.success ? parsedPayload.data.eventType ?? null : null;

  console.info("Payments webhook stub received.", {
    eventType,
    receivedAt: new Date().toISOString()
  });

  const responseData: PaymentsWebhookResponseData = {
    received: true,
    provider: "mock"
  };

  return jsonResponse<PaymentsWebhookResponseData>(202, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
