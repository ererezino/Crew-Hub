import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getAuthMutationBlockReason,
  resolveAuthMutationPolicy
} from "../lib/auth/auth-mutation-guard";

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("auth mutation guard", () => {
  it("allows production Vercel runtime by default", () => {
    const result = resolveAuthMutationPolicy(
      env({ VERCEL_ENV: "production", NODE_ENV: "production" })
    );
    expect(result.allowed).toBe(true);
    expect(getAuthMutationBlockReason(env({ VERCEL_ENV: "production", NODE_ENV: "production" }))).toBeNull();
  });

  it("blocks preview Vercel runtime by default", () => {
    const result = resolveAuthMutationPolicy(
      env({ VERCEL_ENV: "preview", NODE_ENV: "production" })
    );
    expect(result.allowed).toBe(false);
    expect(getAuthMutationBlockReason(env({ VERCEL_ENV: "preview", NODE_ENV: "production" }))).toContain("disabled");
  });

  it("blocks local development by default", () => {
    const result = resolveAuthMutationPolicy(
      env({ NODE_ENV: "development" })
    );
    expect(result.allowed).toBe(false);
  });

  it("allows test runtime to keep route behavior tests functional", () => {
    const result = resolveAuthMutationPolicy(
      env({ NODE_ENV: "test" })
    );
    expect(result.allowed).toBe(true);
  });

  it("supports explicit allow override", () => {
    const result = resolveAuthMutationPolicy(
      env({ AUTH_MUTATION_POLICY: "allow", VERCEL_ENV: "preview" })
    );
    expect(result.allowed).toBe(true);
  });

  it("supports explicit deny override", () => {
    const result = resolveAuthMutationPolicy(
      env({ AUTH_MUTATION_POLICY: "deny", VERCEL_ENV: "production" })
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks auth mutations on non-production runtimes when using production Supabase project", () => {
    const result = resolveAuthMutationPolicy(
      env({
        NODE_ENV: "development",
        AUTH_MUTATION_POLICY: "allow",
        NEXT_PUBLIC_SUPABASE_URL: "https://xmeruhyybvyosqxfleiu.supabase.co",
        PRODUCTION_SUPABASE_PROJECT_REF: "xmeruhyybvyosqxfleiu"
      })
    );

    expect(result.allowed).toBe(false);
    expect(getAuthMutationBlockReason(
      env({
        NODE_ENV: "development",
        AUTH_MUTATION_POLICY: "allow",
        NEXT_PUBLIC_SUPABASE_URL: "https://xmeruhyybvyosqxfleiu.supabase.co",
        PRODUCTION_SUPABASE_PROJECT_REF: "xmeruhyybvyosqxfleiu"
      })
    )).toContain("production Supabase project");
  });

  it("allows explicit override for shared production project in non-production runtime", () => {
    const result = resolveAuthMutationPolicy(
      env({
        NODE_ENV: "development",
        AUTH_MUTATION_POLICY: "allow",
        NEXT_PUBLIC_SUPABASE_URL: "https://xmeruhyybvyosqxfleiu.supabase.co",
        PRODUCTION_SUPABASE_PROJECT_REF: "xmeruhyybvyosqxfleiu",
        AUTH_ALLOW_MUTATIONS_AGAINST_PROD_SUPABASE: "true"
      })
    );

    expect(result.allowed).toBe(true);
  });

  it("enforces guard in invite/reset/create mutation routes", () => {
    const root = path.resolve(__dirname, "..");
    const files = [
      "app/api/v1/people/route.ts",
      "app/api/v1/people/bulk/route.ts",
      "app/api/v1/people/[id]/invite/route.ts",
      "app/api/v1/people/[id]/reset-password/route.ts"
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(root, file), "utf8");
      expect(content).toContain("getAuthMutationBlockReason");
      expect(content).toContain("AUTH_MUTATION_BLOCKED");
    }
  });
});
