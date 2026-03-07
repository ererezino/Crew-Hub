import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 1. Team Hub authz: verify code patterns (static analysis tests)
// ---------------------------------------------------------------------------

describe("Team Hub cross-tenant mutation fix", () => {
  const hubRouteFile = readFileSync(
    join(__dirname, "../app/api/v1/team-hubs/[id]/route.ts"),
    "utf-8"
  );
  const pageRouteFile = readFileSync(
    join(__dirname, "../app/api/v1/team-hubs/pages/[pageId]/route.ts"),
    "utf-8"
  );

  it("hub [id] route includes org_id in all service-role update queries", () => {
    // The service-role update must filter by org_id
    const serviceUpdatePattern = /serviceClient[\s\S]*?\.from\("team_hubs"\)[\s\S]*?\.update\(/g;
    const matches = hubRouteFile.match(serviceUpdatePattern) ?? [];
    expect(matches.length).toBeGreaterThan(0);

    // Every .from("team_hubs").update() block should have .eq("org_id"
    for (const match of matches) {
      const blockEnd = hubRouteFile.indexOf(".single()", hubRouteFile.indexOf(match));
      const block = hubRouteFile.slice(hubRouteFile.indexOf(match), blockEnd);
      expect(block).toContain('eq("org_id"');
    }
  });

  it("hub [id] PUT returns 404 when hub not found (fail-closed)", () => {
    // The PUT handler must have !existingHub → NOT_FOUND check
    const putSection = hubRouteFile.slice(
      hubRouteFile.indexOf("export async function PUT"),
      hubRouteFile.indexOf("export async function DELETE")
    );
    expect(putSection).toContain("!existingHub");
    expect(putSection).toContain('"NOT_FOUND"');
  });

  it("hub [id] DELETE returns 404 when hub not found (fail-closed)", () => {
    const deleteSection = hubRouteFile.slice(
      hubRouteFile.indexOf("export async function DELETE")
    );
    // Must have !existingHub → NOT_FOUND check
    expect(deleteSection).toContain("!existingHub");
    expect(deleteSection).toContain('"NOT_FOUND"');
  });

  it("hub [id] route verifies org_id in the lookup query (not just RLS)", () => {
    // Both PUT and DELETE should have .eq("org_id", ...) in the SELECT query
    const putSection = hubRouteFile.slice(
      hubRouteFile.indexOf("export async function PUT"),
      hubRouteFile.indexOf("export async function DELETE")
    );
    expect(putSection).toContain('.eq("org_id", profile.org_id)');

    const deleteSection = hubRouteFile.slice(
      hubRouteFile.indexOf("export async function DELETE")
    );
    expect(deleteSection).toContain('.eq("org_id", profile.org_id)');
  });

  it("page [pageId] route calls getPageHubOwnership with orgId for all roles", () => {
    // The helper is called outside the isAdmin check block
    const putSection = pageRouteFile.slice(
      pageRouteFile.indexOf("export async function PUT"),
      pageRouteFile.indexOf("export async function DELETE")
    );
    // getPageHubOwnership should be called BEFORE isAdmin check
    const ownershipCall = putSection.indexOf("getPageHubOwnership");
    const isAdminDecl = putSection.indexOf("const isAdmin");
    expect(ownershipCall).toBeGreaterThan(-1);
    expect(ownershipCall).toBeLessThan(isAdminDecl);
  });

  it("page [pageId] helper passes orgId to hub lookup", () => {
    expect(pageRouteFile).toContain("getPageHubOwnership");
    // The function signature should accept orgId
    const helperDecl = pageRouteFile.slice(
      pageRouteFile.indexOf("async function getPageHubOwnership")
    );
    expect(helperDecl).toContain("orgId: string");
    // And use it in the hub query
    expect(helperDecl).toContain('.eq("org_id", orgId)');
  });

  it("hub [id] route does not have the old null-passthrough pattern", () => {
    // Old pattern: if (existingHub && existingHub.department && ...)
    // This should NOT exist — the new code checks !existingHub first
    expect(hubRouteFile).not.toContain(
      "if (existingHub && existingHub.department && existingHub.department !== profile.department)"
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Temporary password exposure
// ---------------------------------------------------------------------------

describe("Temporary password removal", () => {
  it("people create API response type does not include temporaryPassword", () => {
    const typesFile = readFileSync(
      join(__dirname, "../types/people.ts"),
      "utf-8"
    );
    const createResponseSection = typesFile.slice(
      typesFile.indexOf("PeopleCreateResponseData"),
      typesFile.indexOf("PeopleCreateResponse")
    );
    expect(createResponseSection).not.toContain("temporaryPassword");
  });

  it("people password reset response type uses resetInitiated not temporaryPassword", () => {
    const typesFile = readFileSync(
      join(__dirname, "../types/people.ts"),
      "utf-8"
    );
    // Find the type definition block
    const startIdx = typesFile.indexOf("PeoplePasswordResetResponseData = {");
    const endIdx = typesFile.indexOf("};", startIdx) + 2;
    const resetResponseSection = typesFile.slice(startIdx, endIdx);
    expect(resetResponseSection).not.toContain("temporaryPassword");
    expect(resetResponseSection).toContain("resetInitiated");
  });

  it("people create API route does not return temporaryPassword", () => {
    const routeFile = readFileSync(
      join(__dirname, "../app/api/v1/people/route.ts"),
      "utf-8"
    );
    // Should not have temporaryPassword in any jsonResponse call
    const responseBlocks = routeFile.match(/jsonResponse<PeopleCreateResponseData>[\s\S]*?\}\)/g) ?? [];
    for (const block of responseBlocks) {
      expect(block).not.toContain("temporaryPassword");
    }
  });

  it("reset-password API response does not include temporaryPassword", () => {
    const routeFile = readFileSync(
      join(__dirname, "../app/api/v1/people/[id]/reset-password/route.ts"),
      "utf-8"
    );
    // The response block should use resetInitiated, not temporaryPassword
    const responseBlock = routeFile.slice(
      routeFile.indexOf("jsonResponse<PeoplePasswordResetResponseData>")
    );
    expect(responseBlock).toContain("resetInitiated");
    expect(responseBlock).not.toContain("temporaryPassword");
  });

  it("welcome email does not include temporaryPassword parameter", () => {
    const emailFile = readFileSync(
      join(__dirname, "../lib/notifications/email.ts"),
      "utf-8"
    );
    const welcomeSection = emailFile.slice(
      emailFile.indexOf("sendWelcomeEmail"),
      emailFile.indexOf("sendResendEmail", emailFile.indexOf("sendWelcomeEmail") + 50)
    );
    expect(welcomeSection).not.toContain("temporaryPassword");
  });

  it("invite form does not display password", () => {
    const formFile = readFileSync(
      join(__dirname, "../components/admin/invite-form.tsx"),
      "utf-8"
    );
    expect(formFile).not.toContain("admin-users-password-value");
    expect(formFile).not.toContain("Copy password");
  });

  it("admin users client does not display password after reset", () => {
    const clientFile = readFileSync(
      join(__dirname, "../app/(shell)/admin/users/admin-users-client.tsx"),
      "utf-8"
    );
    expect(clientFile).not.toContain("admin-users-password-value");
    expect(clientFile).not.toContain("Copy password");
  });
});

// ---------------------------------------------------------------------------
// 3. Cron auth fail-closed
// ---------------------------------------------------------------------------

describe("Cron auth fail-closed", () => {
  const cronRoutes = [
    "birthday-leave",
    "compliance-reminders",
    "document-expiry",
    "holiday-announcements",
    "leave-announcements",
    "review-reminders"
  ];

  for (const route of cronRoutes) {
    it(`${route} cron route fails closed when CRON_SECRET is missing`, () => {
      const file = readFileSync(
        join(__dirname, `../app/api/cron/${route}/route.ts`),
        "utf-8"
      );
      // Must use !cronSecret (fail-closed)
      expect(file).toContain("!cronSecret || authHeader !==");
      // Must NOT have the old fail-open pattern
      expect(file).not.toContain("cronSecret && authHeader !==");
    });
  }

  it(".env.example includes CRON_SECRET", () => {
    const envExample = readFileSync(
      join(__dirname, "../.env.example"),
      "utf-8"
    );
    expect(envExample).toContain("CRON_SECRET");
  });
});

// ---------------------------------------------------------------------------
// 4. Payment execution disabled
// ---------------------------------------------------------------------------

describe("Payment execution disabled", () => {
  it("payments batch POST returns 403 FEATURE_DISABLED", () => {
    const file = readFileSync(
      join(__dirname, "../app/api/v1/payments/batch/route.ts"),
      "utf-8"
    );
    const postFunc = file.slice(file.indexOf("export async function POST"));
    // First return in the function should be the 403 block
    const firstReturn = postFunc.indexOf("return jsonResponse");
    const firstBlock = postFunc.slice(firstReturn, postFunc.indexOf(";", firstReturn) + 1);
    expect(firstBlock).toContain("403");
    expect(firstBlock).toContain("FEATURE_DISABLED");
  });

  it("payments retry POST returns 403 FEATURE_DISABLED", () => {
    const file = readFileSync(
      join(__dirname, "../app/api/v1/payments/[id]/retry/route.ts"),
      "utf-8"
    );
    const postFunc = file.slice(file.indexOf("export async function POST"));
    const firstReturn = postFunc.indexOf("return jsonResponse");
    const firstBlock = postFunc.slice(firstReturn, postFunc.indexOf(";", firstReturn) + 1);
    expect(firstBlock).toContain("403");
    expect(firstBlock).toContain("FEATURE_DISABLED");
  });

  it("payments webhook POST returns 403 FEATURE_DISABLED", () => {
    const file = readFileSync(
      join(__dirname, "../app/api/v1/payments/webhook/route.ts"),
      "utf-8"
    );
    const postFunc = file.slice(file.indexOf("export async function POST"));
    const firstReturn = postFunc.indexOf("return jsonResponse");
    const firstBlock = postFunc.slice(firstReturn, postFunc.indexOf(";", firstReturn) + 1);
    expect(firstBlock).toContain("403");
    expect(firstBlock).toContain("FEATURE_DISABLED");
  });

  it("payroll run detail client does not render Process payments button", () => {
    const file = readFileSync(
      join(__dirname, "../app/(shell)/payroll/runs/[id]/payroll-run-detail-client.tsx"),
      "utf-8"
    );
    expect(file).not.toContain('"Process payments"');
    expect(file).not.toContain('"Retry payment"');
  });
});

// ---------------------------------------------------------------------------
// 5. schedule_day_notes RLS migration
// ---------------------------------------------------------------------------

describe("schedule_day_notes RLS fix", () => {
  it("migration drops permissive policies and creates org-scoped ones", () => {
    const file = readFileSync(
      join(__dirname, "../supabase/migrations/20260306630000_fix_schedule_day_notes_rls.sql"),
      "utf-8"
    );
    expect(file).toContain("DROP POLICY IF EXISTS schedule_day_notes_select");
    expect(file).toContain("DROP POLICY IF EXISTS schedule_day_notes_manage");
    expect(file).toContain("s.org_id =");
    // Should not contain USING (true) or WITH CHECK (true)
    expect(file).not.toContain("USING (true)");
    expect(file).not.toContain("WITH CHECK (true)");
  });
});
