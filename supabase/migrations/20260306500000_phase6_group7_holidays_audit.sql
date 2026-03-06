-- Phase 6 Group 7: Seed 2026 public holidays for NG, GH, KE, ZA, CA
-- and create an audit_log_view for settings page display.
-- Idempotent: uses ON CONFLICT to skip existing rows.

-- ============================================================
-- 1. Seed 2026 public holidays per organization
-- ============================================================
-- Each org gets the full set of holidays for all five countries.
-- The unique constraint (org_id, country_code, date) prevents duplicates.

INSERT INTO public.holiday_calendars (org_id, country_code, date, name, year)
SELECT org.id, v.country_code, v.date::date, v.name, 2026
FROM public.orgs org
CROSS JOIN (VALUES
  -- Nigeria (NG)
  ('NG', '2026-01-01', 'New Year''s Day'),
  ('NG', '2026-03-20', 'Eid al-Fitr (estimated)'),
  ('NG', '2026-03-21', 'Eid al-Fitr Holiday (estimated)'),
  ('NG', '2026-04-03', 'Good Friday'),
  ('NG', '2026-04-06', 'Easter Monday'),
  ('NG', '2026-05-01', 'Workers'' Day'),
  ('NG', '2026-05-27', 'Children''s Day'),
  ('NG', '2026-06-12', 'Democracy Day'),
  ('NG', '2026-10-01', 'Independence Day'),
  ('NG', '2026-12-25', 'Christmas Day'),
  ('NG', '2026-12-26', 'Boxing Day'),

  -- Ghana (GH)
  ('GH', '2026-01-01', 'New Year''s Day'),
  ('GH', '2026-03-06', 'Independence Day'),
  ('GH', '2026-04-03', 'Good Friday'),
  ('GH', '2026-04-06', 'Easter Monday'),
  ('GH', '2026-05-01', 'May Day'),
  ('GH', '2026-05-25', 'Africa Day'),
  ('GH', '2026-07-01', 'Republic Day'),
  ('GH', '2026-08-04', 'Founders'' Day'),
  ('GH', '2026-09-21', 'Kwame Nkrumah Memorial Day'),
  ('GH', '2026-12-25', 'Christmas Day'),
  ('GH', '2026-12-26', 'Boxing Day'),

  -- Kenya (KE)
  ('KE', '2026-01-01', 'New Year''s Day'),
  ('KE', '2026-04-03', 'Good Friday'),
  ('KE', '2026-04-06', 'Easter Monday'),
  ('KE', '2026-05-01', 'Labour Day'),
  ('KE', '2026-06-01', 'Madaraka Day'),
  ('KE', '2026-10-10', 'Huduma Day'),
  ('KE', '2026-10-20', 'Mashujaa Day'),
  ('KE', '2026-12-12', 'Jamhuri Day'),
  ('KE', '2026-12-25', 'Christmas Day'),
  ('KE', '2026-12-26', 'Boxing Day'),

  -- South Africa (ZA)
  ('ZA', '2026-01-01', 'New Year''s Day'),
  ('ZA', '2026-03-21', 'Human Rights Day'),
  ('ZA', '2026-04-03', 'Good Friday'),
  ('ZA', '2026-04-06', 'Family Day'),
  ('ZA', '2026-04-27', 'Freedom Day'),
  ('ZA', '2026-05-01', 'Workers'' Day'),
  ('ZA', '2026-06-16', 'Youth Day'),
  ('ZA', '2026-08-09', 'National Women''s Day'),
  ('ZA', '2026-09-24', 'Heritage Day'),
  ('ZA', '2026-12-16', 'Day of Reconciliation'),
  ('ZA', '2026-12-25', 'Christmas Day'),
  ('ZA', '2026-12-26', 'Day of Goodwill'),

  -- Canada (CA)
  ('CA', '2026-01-01', 'New Year''s Day'),
  ('CA', '2026-02-16', 'Family Day'),
  ('CA', '2026-04-03', 'Good Friday'),
  ('CA', '2026-05-18', 'Victoria Day'),
  ('CA', '2026-07-01', 'Canada Day'),
  ('CA', '2026-09-07', 'Labour Day'),
  ('CA', '2026-10-12', 'Thanksgiving Day'),
  ('CA', '2026-11-11', 'Remembrance Day'),
  ('CA', '2026-12-25', 'Christmas Day'),
  ('CA', '2026-12-26', 'Boxing Day')
) AS v(country_code, date, name)
ON CONFLICT (org_id, country_code, date) DO NOTHING;

-- ============================================================
-- 2. Audit log view for settings page display
-- ============================================================
-- Joins audit_log with actor profile info so the UI can display
-- human-readable audit entries without extra queries.
-- RLS on the underlying audit_log table still governs access.

CREATE OR REPLACE VIEW public.audit_log_view AS
SELECT
  al.id,
  al.org_id,
  al.actor_user_id,
  p.full_name    AS actor_name,
  p.email        AS actor_email,
  al.action,
  al.table_name,
  al.record_id,
  al.old_value,
  al.new_value,
  al.ip_address,
  al.created_at
FROM public.audit_log al
LEFT JOIN public.profiles p
  ON p.id = al.actor_user_id
 AND p.deleted_at IS NULL;

-- Grant read access to authenticated users (RLS on audit_log enforces org scoping)
GRANT SELECT ON public.audit_log_view TO authenticated;

COMMENT ON VIEW public.audit_log_view IS
  'Read-only view joining audit_log with actor profile details for settings page display.';
