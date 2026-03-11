import { extractSupabaseProjectRef } from "../supabase/project-ref";

type AuthMutationPolicy = "production_only" | "allow" | "deny";

type PolicyResolution = {
  allowed: boolean;
  policy: AuthMutationPolicy;
  reason?: string;
};

function normalizePolicy(rawPolicy: string | undefined): AuthMutationPolicy {
  const value = rawPolicy?.trim().toLowerCase();
  if (value === "allow") return "allow";
  if (value === "deny") return "deny";
  return "production_only";
}

function isRuntimeProduction(env: NodeJS.ProcessEnv): boolean {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv) {
    return vercelEnv === "production";
  }

  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv === "production";
}

function shouldBlockSharedProductionProjectMutations(
  env: NodeJS.ProcessEnv
): boolean {
  const guardOverride = env.AUTH_PROD_PROJECT_GUARD?.trim().toLowerCase();
  if (guardOverride === "false") {
    return false;
  }

  const productionProjectRef =
    env.PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase() || "";
  const currentProjectRef =
    extractSupabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL)?.toLowerCase() || "";

  if (!productionProjectRef || !currentProjectRef) {
    return false;
  }

  if (productionProjectRef !== currentProjectRef) {
    return false;
  }

  if (isRuntimeProduction(env)) {
    return false;
  }

  const allowOverride =
    env.AUTH_ALLOW_MUTATIONS_AGAINST_PROD_SUPABASE?.trim().toLowerCase() === "true";

  return !allowOverride;
}

export function resolveAuthMutationPolicy(
  env: NodeJS.ProcessEnv = process.env
): PolicyResolution {
  const policy = normalizePolicy(env.AUTH_MUTATION_POLICY);

  if (policy === "allow") {
    if (shouldBlockSharedProductionProjectMutations(env)) {
      return {
        allowed: false,
        policy,
        reason:
          "Authentication mutations are blocked because this runtime points to the production Supabase project."
      };
    }

    return { allowed: true, policy };
  }

  if (policy === "deny") {
    return { allowed: false, policy };
  }

  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();

  if (vercelEnv) {
    const allowed = vercelEnv === "production";
    if (!allowed) {
      return { allowed, policy };
    }

    return { allowed, policy };
  }

  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "test") {
    if (shouldBlockSharedProductionProjectMutations(env)) {
      return {
        allowed: false,
        policy,
        reason:
          "Authentication mutations are blocked because this runtime points to the production Supabase project."
      };
    }

    return { allowed: true, policy };
  }

  const allowed = nodeEnv === "production";
  if (!allowed) {
    return { allowed, policy };
  }

  if (shouldBlockSharedProductionProjectMutations(env)) {
    return {
      allowed: false,
      policy,
      reason:
        "Authentication mutations are blocked because this runtime points to the production Supabase project."
    };
  }

  return { allowed: true, policy };
}

export function getAuthMutationBlockReason(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const resolution = resolveAuthMutationPolicy(env);

  if (resolution.allowed) {
    return null;
  }

  if (resolution.reason) {
    return resolution.reason;
  }

  return "Authentication mutations are disabled in this runtime. Use the production deployment.";
}
