-- Fix navigation_access_config after nav restructure:
-- /documents was previously "My Documents" (ALL_ROLES), now it's "Document management" (HR_ADMIN, SUPER_ADMIN)
-- /me/documents is the new "Documents" personal page (ALL_ROLES)

-- Restrict /documents to admin-only roles
UPDATE navigation_access_config
SET visible_to_roles = ARRAY['HR_ADMIN', 'SUPER_ADMIN'],
    updated_at = now()
WHERE nav_item_key = '/documents';

-- Insert /me/documents for all orgs that have navigation_access_config rows
-- (i.e., orgs where seedDefaultsIfNeeded has already run)
INSERT INTO navigation_access_config (org_id, nav_item_key, visible_to_roles, granted_employee_ids, revoked_employee_ids, updated_by)
SELECT DISTINCT
  org_id,
  '/me/documents',
  ARRAY['EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'HR_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN'],
  ARRAY[]::uuid[],
  ARRAY[]::uuid[],
  updated_by
FROM navigation_access_config
WHERE nav_item_key = '/documents'
ON CONFLICT (org_id, nav_item_key) DO NOTHING;

-- Also insert /crew-games if missing (added in recent nav update)
INSERT INTO navigation_access_config (org_id, nav_item_key, visible_to_roles, granted_employee_ids, revoked_employee_ids, updated_by)
SELECT DISTINCT
  org_id,
  '/crew-games',
  ARRAY['EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'HR_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN'],
  ARRAY[]::uuid[],
  ARRAY[]::uuid[],
  updated_by
FROM navigation_access_config
WHERE nav_item_key = '/documents'
ON CONFLICT (org_id, nav_item_key) DO NOTHING;
