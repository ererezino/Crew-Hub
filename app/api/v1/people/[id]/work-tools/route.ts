import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import { canViewWorkToolsForPerson, isWorkToolOutstanding } from "../../../../../../lib/work-tools";
import type { AppRole } from "../../../../../../types/auth";
import type { PersonWorkToolsResponseData } from "../../../../../../types/work-tools";
import {
  WORK_TOOL_REQUEST_SELECT,
  WORK_TOOL_SELECT,
  buildMeta,
  hydrateWorkToolRequests,
  hydrateWorkTools,
  jsonResponse
} from "../../../work-tools/_shared";

const paramsSchema = z.object({
  id: z.string().uuid("Employee id must be a valid UUID.")
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view work tools."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid employee id."
      },
      meta: buildMeta()
    });
  }

  const employeeId = parsedParams.data.id;

  if (!canViewWorkToolsForPerson(profile.roles as AppRole[], profile.id, employeeId)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to view this employee's work tools."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const [toolResult, requestResult] = await Promise.all([
    serviceClient
      .from("work_tools")
      .select(WORK_TOOL_SELECT)
      .eq("org_id", profile.org_id)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("assigned_at", { ascending: false }),
    serviceClient
      .from("work_tool_requests")
      .select(WORK_TOOL_REQUEST_SELECT)
      .eq("org_id", profile.org_id)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
  ]);

  if (toolResult.error || requestResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOLS_FETCH_FAILED",
        message: "Unable to load work tools right now."
      },
      meta: buildMeta()
    });
  }

  try {
    const [tools, requests] = await Promise.all([
      hydrateWorkTools(serviceClient, profile.org_id, toolResult.data ?? []),
      hydrateWorkToolRequests(serviceClient, profile.org_id, requestResult.data ?? [])
    ]);

    return jsonResponse<PersonWorkToolsResponseData>(200, {
      data: {
        tools,
        requests,
        outstandingAssignedCount: tools.filter((tool) => isWorkToolOutstanding(tool.status)).length
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOLS_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load work tools right now."
      },
      meta: buildMeta()
    });
  }
}
