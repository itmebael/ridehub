-- ============================================================================
-- Out-of-boundary penalty on vehicles (RideHub / Carrental)
-- ============================================================================
-- Amount in PHP that the owner charges if the rental leaves the allowed GPS
-- boundary during a booking (policy text is shown in the app; enforcement is
-- between owner and renter). Safe to run multiple times.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'public.vehicles does not exist; skipping out_of_boundary_penalty_php migration.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'out_of_boundary_penalty_php'
  ) THEN
    ALTER TABLE public.vehicles
      ADD COLUMN out_of_boundary_penalty_php DECIMAL(10, 2) NOT NULL DEFAULT 0
      CHECK (out_of_boundary_penalty_php >= 0);
    COMMENT ON COLUMN public.vehicles.out_of_boundary_penalty_php IS 'PHP penalty if renter/vehicle leaves allowed boundary during rental (owner-defined).';
  END IF;
END $$;
