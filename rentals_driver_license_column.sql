-- ============================================================================
-- Driver's license on rental requests (RideHub / Carrental)
-- ============================================================================
-- Stores the renter's driver's license number (or ID as issued by LTO, etc.)
-- for each rental row. Safe to run multiple times in Supabase SQL Editor.
--
-- App: ClientDashboard inserts driver_license when submitting a rent request.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.rentals') IS NULL THEN
    RAISE NOTICE 'public.rentals does not exist; skipping driver_license migration.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rentals' AND column_name = 'driver_license'
  ) THEN
    ALTER TABLE public.rentals
      ADD COLUMN driver_license VARCHAR(255);
    COMMENT ON COLUMN public.rentals.driver_license IS 'Renter driver''s license number (or equivalent ID) supplied at booking.';
  END IF;
END $$;
