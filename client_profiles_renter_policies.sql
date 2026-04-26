-- ============================================================================
-- RLS: clients can manage their own row in client_profiles
-- ============================================================================
-- Run in Supabase if renters get errors saving profile / client_profiles
-- upsert fails with RLS. Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.client_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients select own client_profiles" ON public.client_profiles;
CREATE POLICY "Clients select own client_profiles"
  ON public.client_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Clients insert own client_profiles" ON public.client_profiles;
CREATE POLICY "Clients insert own client_profiles"
  ON public.client_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Clients update own client_profiles" ON public.client_profiles;
CREATE POLICY "Clients update own client_profiles"
  ON public.client_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
