import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), "utf-8");
}

describe("People access consistency", () => {
  it("derives explicit action-level permissions in people page", () => {
    const pageFile = read("app/(shell)/people/page.tsx");

    expect(pageFile).toContain('const canCreatePeople = hasRole(roles, "SUPER_ADMIN");');
    expect(pageFile).toContain(
      'const canInvitePeople = hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");'
    );
    expect(pageFile).toContain(
      'const canResetAuthenticator = hasRole(roles, "SUPER_ADMIN");'
    );
    expect(pageFile).toContain("canCreatePeople={canCreatePeople}");
    expect(pageFile).toContain("canInvitePeople={canInvitePeople}");
    expect(pageFile).toContain("canEditPeople={canEditPeople}");
    expect(pageFile).toContain("canResetAuthenticator={canResetAuthenticator}");
  });

  it("no longer uses the coarse canManagePeople prop in people client", () => {
    const clientFile = read("app/(shell)/people/people-client.tsx");
    expect(clientFile).not.toContain("canManagePeople");
    expect(clientFile).toContain("canCreatePeople: boolean;");
    expect(clientFile).toContain("canInvitePeople: boolean;");
    expect(clientFile).toContain("canEditPeople: boolean;");
    expect(clientFile).toContain("canResetAuthenticator: boolean;");
  });

  it("exposes reset setup link + copy action in reset authenticator modal", () => {
    const clientFile = read("app/(shell)/people/people-client.tsx");
    expect(clientFile).toContain("const [resetSetupLink, setResetSetupLink] = useState<string | null>(null);");
    expect(clientFile).toContain("payload.data.setupLink ?? null");
    expect(clientFile).toContain('placeholder="Click “Reset Authenticator” to generate a setup link."');
    expect(clientFile).toContain("handleCopyResetSetupLink");
    expect(clientFile).toContain("Generate new link");
  });

  it("server-side people create/reset routes remain super-admin protected", () => {
    const createRoute = read("app/api/v1/people/route.ts");
    const resetRoute = read("app/api/v1/people/[id]/reset-password/route.ts");

    expect(createRoute).toContain("return hasRole(userRoles, \"SUPER_ADMIN\");");
    expect(resetRoute).toContain("Only Super Admin can reset authenticator access.");
  });
});
