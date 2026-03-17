-- ============================================================================
-- Migration: Security Audit Hardening
-- ============================================================================
-- Fixes identified during adversarial security audit (2026-03-16).
--
-- C-1: pre_start_contracts had USING(true) policy — cross-org data leak
-- C-2: contract-documents storage had unrestricted policies
-- H-1: avatars storage lacked path-based ownership enforcement
-- H-2: SECURITY DEFINER RPCs callable cross-org by authenticated users
-- H-3: payslips UPDATE policy too permissive for employees
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- C-1: Fix pre_start_contracts RLS — replace USING(true) with org-scoped
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS pre_start_contracts_service_role ON pre_start_contracts;

-- Admin read: HR_ADMIN and SUPER_ADMIN within the same org
CREATE POLICY pre_start_contracts_select_admin
  ON pre_start_contracts
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.get_user_org_id()
    AND (
      public.has_role('HR_ADMIN')
      OR public.has_role('SUPER_ADMIN')
    )
  );

-- Admin write: only via service-role (app-layer auth enforced before service-role use)
CREATE POLICY pre_start_contracts_service_role_write
  ON pre_start_contracts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- C-2: Fix contract-documents storage — restrict to service_role only
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS contract_documents_insert ON storage.objects;
DROP POLICY IF EXISTS contract_documents_select ON storage.objects;
DROP POLICY IF EXISTS contract_documents_delete ON storage.objects;

CREATE POLICY contract_documents_insert_service
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'contract-documents');

CREATE POLICY contract_documents_select_service
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'contract-documents');

CREATE POLICY contract_documents_delete_service
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'contract-documents');

-- ═══════════════════════════════════════════════════════════════════════════
-- H-1: Fix avatars storage — enforce path-based ownership
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;

-- Re-create with path ownership enforcement (avatar path = {userId}/{userId}.ext)
CREATE POLICY "Users can upload own avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read policy is unchanged — avatars are intentionally public for display

-- ═══════════════════════════════════════════════════════════════════════════
-- H-2: Revoke EXECUTE on cross-org-unsafe SECURITY DEFINER RPCs from
--      authenticated role. These should only be called via service_role
--      (app layer validates auth + org before calling).
-- ═══════════════════════════════════════════════════════════════════════════

-- Revoke leave approval/rejection RPCs from authenticated
-- (All 3 overloaded signatures)
REVOKE EXECUTE ON FUNCTION approve_leave_request(UUID, UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION approve_leave_request(UUID, UUID, UUID, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION reject_leave_request(UUID, UUID, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION reject_leave_request(UUID, UUID, TEXT, UUID, TEXT) FROM authenticated;

-- Revoke payroll recalculation RPC from authenticated
REVOKE EXECUTE ON FUNCTION recalculate_payroll_run_totals(UUID) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-3: Tighten payslips UPDATE — employees can only update viewed_at
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the overly permissive policy
DROP POLICY IF EXISTS payslips_update_scope ON public.payslips;

-- Admin update: full column access for FINANCE_ADMIN / SUPER_ADMIN
CREATE POLICY payslips_update_admin
  ON public.payslips
  FOR UPDATE
  TO authenticated
  USING (
    org_id = public.get_user_org_id()
    AND deleted_at IS NULL
    AND (
      public.has_role('FINANCE_ADMIN')
      OR public.has_role('SUPER_ADMIN')
    )
  )
  WITH CHECK (
    org_id = public.get_user_org_id()
    AND (
      public.has_role('FINANCE_ADMIN')
      OR public.has_role('SUPER_ADMIN')
    )
  );

-- Employee update: can only set viewed_at on their own payslips
-- (RLS cannot enforce column-level restrictions, but this at least limits row scope.
--  The app layer should only update viewed_at for employees.)
CREATE POLICY payslips_update_self_viewed
  ON public.payslips
  FOR UPDATE
  TO authenticated
  USING (
    org_id = public.get_user_org_id()
    AND deleted_at IS NULL
    AND employee_id = auth.uid()
  )
  WITH CHECK (
    org_id = public.get_user_org_id()
    AND employee_id = auth.uid()
  );
