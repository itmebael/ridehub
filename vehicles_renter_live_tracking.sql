-- Live GPS from renter when owner taps "Track on Map" on an approved booking.
-- 1) Run this in Supabase SQL Editor.
-- 2) Owner flow sets vehicles.renter_tracking_requested_at (see OwnerDashboard).
-- 3) Renter app calls push_renter_vehicle_location when tracking is requested (see ClientDashboard).

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS renter_tracking_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vehicles.renter_tracking_requested_at IS
  'When the owner requests live renter GPS (Track on map). Renter app uploads position while this is recent.';

DROP FUNCTION IF EXISTS public.push_renter_vehicle_location(uuid, double precision, double precision);
CREATE OR REPLACE FUNCTION public.push_renter_vehicle_location(
  p_vehicle_id uuid,
  p_lat double precision,
  p_lng double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me text := COALESCE(
    NULLIF(LOWER(TRIM(auth.jwt() ->> 'email')), ''),
    (SELECT NULLIF(LOWER(TRIM(u.email)), '') FROM public.app_users u WHERE u.user_id = auth.uid() LIMIT 1)
  );
BEGIN
  IF me IS NULL OR me = '' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid vehicle';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.rentals r
    WHERE r.vehicle_id = p_vehicle_id
      AND r.status = 'approved'
      AND (
        LOWER(TRIM(COALESCE(r.tenant_email, ''))) = me
        OR LOWER(TRIM(COALESCE(r.client_email, ''))) = me
      )
  ) THEN
    RAISE EXCEPTION 'no approved rental for this vehicle';
  END IF;

  UPDATE public.vehicles
  SET
    current_lat = p_lat,
    current_lng = p_lng,
    tracking_last_ping = now(),
    tracking_enabled = true,
    tracking_provider = 'Renter device GPS'
  WHERE id = p_vehicle_id;
END;
$$;

REVOKE ALL ON FUNCTION public.push_renter_vehicle_location(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_renter_vehicle_location(uuid, double precision, double precision) TO authenticated;
