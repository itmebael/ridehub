-- Run in Supabase SQL editor if you already have notify_owner_when_vehicle_leaves_square
-- and only need renter notifications. Otherwise use the version in FULL_SYSTEM.sql.

CREATE OR REPLACE FUNCTION public.notify_owner_when_vehicle_leaves_square()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    is_outside BOOLEAN := FALSE;
    was_outside BOOLEAN := FALSE;
    north_limit DOUBLE PRECISION;
    south_limit DOUBLE PRECISION;
    east_limit DOUBLE PRECISION;
    west_limit DOUBLE PRECISION;
    renter_row RECORD;
BEGIN
    IF NEW.owner_email IS NULL
       OR NEW.current_lat IS NULL
       OR NEW.current_lng IS NULL
       OR NEW.boundary_north_lat IS NULL
       OR NEW.boundary_south_lat IS NULL
       OR NEW.boundary_east_lng IS NULL
       OR NEW.boundary_west_lng IS NULL THEN
        RETURN NEW;
    END IF;

    north_limit := GREATEST(NEW.boundary_north_lat, NEW.boundary_south_lat);
    south_limit := LEAST(NEW.boundary_north_lat, NEW.boundary_south_lat);
    east_limit := GREATEST(NEW.boundary_east_lng, NEW.boundary_west_lng);
    west_limit := LEAST(NEW.boundary_east_lng, NEW.boundary_west_lng);

    is_outside := NEW.current_lat > north_limit
        OR NEW.current_lat < south_limit
        OR NEW.current_lng > east_limit
        OR NEW.current_lng < west_limit;

    IF OLD.current_lat IS NOT NULL
       AND OLD.current_lng IS NOT NULL
       AND OLD.boundary_north_lat IS NOT NULL
       AND OLD.boundary_south_lat IS NOT NULL
       AND OLD.boundary_east_lng IS NOT NULL
       AND OLD.boundary_west_lng IS NOT NULL THEN
        was_outside := OLD.current_lat > GREATEST(OLD.boundary_north_lat, OLD.boundary_south_lat)
            OR OLD.current_lat < LEAST(OLD.boundary_north_lat, OLD.boundary_south_lat)
            OR OLD.current_lng > GREATEST(OLD.boundary_east_lng, OLD.boundary_west_lng)
            OR OLD.current_lng < LEAST(OLD.boundary_east_lng, OLD.boundary_west_lng);
    END IF;

    IF is_outside AND NOT was_outside THEN
        PERFORM public.send_notification(
            NEW.owner_email,
            'Vehicle boundary alert',
            FORMAT(
                'The vehicle "%s" moved outside its %sm x %sm boundary square. Current position: %s, %s.',
                COALESCE(NEW.title, 'Vehicle'),
                COALESCE(NEW.boundary_size_meters, 0),
                COALESCE(NEW.boundary_size_meters, 0),
                ROUND(NEW.current_lat::NUMERIC, 6),
                ROUND(NEW.current_lng::NUMERIC, 6)
            ),
            'vehicle_boundary_alert',
            'high',
            NULL,
            NEW.id
        );

        FOR renter_row IN
            SELECT DISTINCT TRIM(tenant_email) AS tenant_email
            FROM public.rentals
            WHERE vehicle_id = NEW.id
              AND status = 'approved'
              AND tenant_email IS NOT NULL
              AND TRIM(tenant_email) <> ''
              AND (
                  check_in_date IS NULL
                  OR check_out_date IS NULL
                  OR (
                      CURRENT_DATE >= check_in_date
                      AND CURRENT_DATE <= check_out_date
                  )
              )
        LOOP
            IF LOWER(renter_row.tenant_email) IS DISTINCT FROM LOWER(TRIM(COALESCE(NEW.owner_email, ''))) THEN
                PERFORM public.send_notification(
                    renter_row.tenant_email,
                    'Vehicle left allowed area',
                    FORMAT(
                        'The vehicle "%s" you are renting moved outside its allowed boundary. Last position: %s, %s. Contact the owner if you need help.',
                        COALESCE(NEW.title, 'Vehicle'),
                        ROUND(NEW.current_lat::NUMERIC, 6),
                        ROUND(NEW.current_lng::NUMERIC, 6)
                    ),
                    'vehicle_boundary_alert',
                    'high',
                    NULL,
                    NEW.id
                );
            END IF;
        END LOOP;

        NEW.geofence_alert_sent_at := NOW();
    ELSIF NOT is_outside THEN
        NEW.geofence_alert_sent_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;
