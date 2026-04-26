-- Fix owner rental actions in Supabase:
-- 1) Owners need SELECT/UPDATE on rentals for their vehicles.
-- 2) If you see "permission denied for table users (42501)", the rooms RLS policy was
--    subquerying auth.users (not allowed for the authenticated role). Recreate it using JWT email only.

ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view rentals for own vehicles" ON public.rentals;
CREATE POLICY "Owners can view rentals for own vehicles" ON public.rentals
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.vehicles v
            WHERE v.id = rentals.vehicle_id
            AND LOWER(TRIM(COALESCE(v.owner_email, ''))) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
        )
    );

DROP POLICY IF EXISTS "Owners can update rentals for own vehicles" ON public.rentals;
CREATE POLICY "Owners can update rentals for own vehicles" ON public.rentals
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.vehicles v
            WHERE v.id = rentals.vehicle_id
            AND LOWER(TRIM(COALESCE(v.owner_email, ''))) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.vehicles v
            WHERE v.id = rentals.vehicle_id
            AND LOWER(TRIM(COALESCE(v.owner_email, ''))) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
        )
    );

-- Safe rooms policy (no auth.users read — fixes 42501 when rental triggers update rooms)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can manage own rooms" ON public.rooms;
CREATE POLICY "Owners can manage own rooms" ON public.rooms
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.vehicles p
            JOIN public.vehicle_owner_profiles op ON p.owner_email = op.email
            WHERE p.id = rooms.vehicle_id
            AND (
                op.user_id = auth.uid()
                OR LOWER(TRIM(op.email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.vehicles p
            JOIN public.vehicle_owner_profiles op ON p.owner_email = op.email
            WHERE p.id = rooms.vehicle_id
            AND (
                op.user_id = auth.uid()
                OR LOWER(TRIM(op.email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
            )
        )
    );
