import { buildMeta, jsonResponse } from "../_helpers";

export async function POST(_request: Request) {
  // Payment webhook is disabled for the current release (mock provider only).
  return jsonResponse<null>(403, {
    data: null,
    error: {
      code: "FEATURE_DISABLED",
      message: "Payment webhook is not available in the current release."
    },
    meta: buildMeta()
  });
}
