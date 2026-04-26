-- ============================================================================
-- Hourly rental booking columns (RideHub / Carrental)
-- ============================================================================
-- Adds structured fields for per-hour plans alongside check_in_date /
-- check_out_date and total_amount. Safe to run multiple times in Supabase
-- SQL Editor.
--
-- App: ClientDashboard inserts rental_unit, pick_up_time, return_time,
-- billable_hours, hourly_rate_snapshot when the plan is "hour".
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.rentals') IS NULL THEN
    RAISE NOTICE 'public.rentals does not exist; skipping hourly columns migration.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rentals' AND column_name = 'rental_unit'
  ) THEN
    ALTER TABLE public.rentals
      ADD COLUMN rental_unit VARCHAR(20)
      CHECK (rental_unit IS NULL OR rental_unit IN ('hour', 'day', 'week', 'month'));
    COMMENT ON COLUMN public.rentals.rental_unit IS 'Pricing plan: hour, day, week, or month.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rentals' AND column_name = 'pick_up_time'
  ) THEN
    ALTER TABLE public.rentals
      ADD COLUMN pick_up_time VARCHAR(8);
    COMMENT ON COLUMN public.rentals.pick_up_time IS 'Pick-up clock time for hourly rentals (HH:MM, 24h).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rentals' AND column_name = 'return_time'
  ) THEN
    ALTER TABLE public.rentals
      ADD COLUMN return_time VARCHAR(8);
    COMMENT ON COLUMN public.rentals.return_time IS 'Return clock time for hourly rentals (HH:MM, 24h).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rentals' AND column_name = 'billable_hours'
  ) THEN
    ALTER TABLE public.rentals
      ADD COLUMN billable_hours INTEGER
      CHECK (billable_hours IS NULL OR billable_hours >= 0);
    COMMENT ON COLUMN public.rentals.billable_hours IS 'Whole hours billed for hourly plan (ceil of duration).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rentals' AND column_name = 'hourly_rate_snapshot'
  ) THEN
    ALTER TABLE public.rentals
      ADD COLUMN hourly_rate_snapshot DECIMAL(10, 2);
    COMMENT ON COLUMN public.rentals.hourly_rate_snapshot IS 'Hourly rate (PHP) used when computing total_amount for hourly rentals.';
  END IF;
END $$;
