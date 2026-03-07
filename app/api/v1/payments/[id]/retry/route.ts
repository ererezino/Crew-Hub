import { buildMeta, jsonResponse } from "../../_helpers";

export async function POST(
  _request: Request,
  _context: { params: Promise<{ id: string }> }
) {
  // Payment processing is disabled for the current release (mock provider only).
  return jsonResponse<null>(403, {
    data: null,
    error: {
      code: "FEATURE_DISABLED",
      message: "Payment processing is not available in the current release."
    },
    meta: buildMeta()
  });
}
