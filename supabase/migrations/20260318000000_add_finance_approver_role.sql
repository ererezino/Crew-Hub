-- Add FINANCE_APPROVER to role_module_config CHECK constraint
-- Phase 1 of payroll redesign: role and governance groundwork

ALTER TABLE public.role_module_config
  DROP CONSTRAINT IF EXISTS role_module_config_role_check;

ALTER TABLE public.role_module_config
  ADD CONSTRAINT role_module_config_role_check
  CHECK (role IN ('EMPLOYEE','TEAM_LEAD','MANAGER','HR_ADMIN','FINANCE_ADMIN','FINANCE_APPROVER','SUPER_ADMIN'));
