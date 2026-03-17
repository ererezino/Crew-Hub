import { NextResponse } from "next/server";

/**
 * DEPRECATED: This endpoint previously read/wrote to `role_module_config`,
 * which was disconnected from actual access enforcement.
 *
 * Access control is now unified under `navigation_access_config` and
 * `dashboard_widget_config`, managed via `/api/v1/admin/access-config`.
 *
 * This route returns 410 Gone to signal the migration.
 */

function goneResponse() {
  return NextResponse.json(
    {
      data: null,
      error: {
        code: "GONE",
        message:
          "This endpoint has been retired. Role permissions are now managed via /api/v1/admin/access-config."
      },
      meta: { timestamp: new Date().toISOString() }
    },
    { status: 410 }
  );
}

export function GET() {
  return goneResponse();
}

export function PUT() {
  return goneResponse();
}
