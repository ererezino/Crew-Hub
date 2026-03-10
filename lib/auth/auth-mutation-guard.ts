type AuthMutationPolicy = "production_only" | "allow" | "deny";

type PolicyResolution = {
  allowed: boolean;
  policy: AuthMutationPolicy;
};

function normalizePolicy(rawPolicy: string | undefined): AuthMutationPolicy {
  const value = rawPolicy?.trim().toLowerCase();
  if (value === "allow") return "allow";
  if (value === "deny") return "deny";
  return "production_only";
}

export function resolveAuthMutationPolicy(
  env: NodeJS.ProcessEnv = process.env
): PolicyResolution {
  const policy = normalizePolicy(env.AUTH_MUTATION_POLICY);

  if (policy === "allow") {
    return { allowed: true, policy };
  }

  if (policy === "deny") {
    return { allowed: false, policy };
  }

  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();

  if (vercelEnv) {
    return { allowed: vercelEnv === "production", policy };
  }

  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "test") {
    return { allowed: true, policy };
  }

  return { allowed: nodeEnv === "production", policy };
}

export function getAuthMutationBlockReason(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const resolution = resolveAuthMutationPolicy(env);

  if (resolution.allowed) {
    return null;
  }

  return "Authentication mutations are disabled in this runtime. Use the production deployment.";
}
