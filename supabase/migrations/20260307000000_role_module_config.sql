-- Role module configuration: allows super admins to customise which modules each role can access.
-- One row per org + role. If no row exists, the app falls back to hardcoded defaults.

CREATE TABLE IF NOT EXISTS public.role_module_config (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      uuid        NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('EMPLOYEE','TEAM_LEAD','MANAGER','HR_ADMIN','FINANCE_ADMIN','SUPER_ADMIN')),
  enabled_modules jsonb   NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid        REFERENCES public.profiles(id),
  UNIQUE(org_id, role)
);

COMMENT ON TABLE public.role_module_config IS 'Per-org overrides for which nav modules a role can access.';

-- Index for fast lookups by org
CREATE INDEX IF NOT EXISTS idx_role_module_config_org
  ON public.role_module_config(org_id);

-- RLS
ALTER TABLE public.role_module_config ENABLE ROW LEVEL SECURITY;

-- Super admins can read and write their org's config
CREATE POLICY "super_admins_manage_role_module_config"
  ON public.role_module_config
  FOR ALL
  USING (
    org_id IN (
      SELECT p.org_id
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND 'SUPER_ADMIN' = ANY(p.roles::text[])
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT p.org_id
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND 'SUPER_ADMIN' = ANY(p.roles::text[])
    )
  );
