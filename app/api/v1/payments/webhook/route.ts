import type { PaymentsWebhookResponseData } from "../../../../../types/payments";
import { buildMeta, jsonResponse } from "../_helpers";

export async function POST(request: Request) {
  let payload: unknown = null;

  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const eventType =
    payload && typeof payload === "object" && "eventType" in payload
      ? (payload as { eventType?: unknown }).eventType
      : null;

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
