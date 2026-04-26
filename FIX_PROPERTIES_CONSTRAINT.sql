-- FIX FOR Vehicles STATUS CONSTRAINT
-- This SQL will allow 'pending' status in the Vehicles table
-- Copy and paste this entire script into your Supabase SQL Editor

-- 1. First, drop the existing constraint
ALTER TABLE public.Vehicles 
DROP CONSTRAINT IF EXISTS Vehicles_status_check;

-- 2. Create a new constraint that allows 'pending', 'available', 'full', and 'rejected' statuses
ALTER TABLE public.Vehicles 
ADD CONSTRAINT Vehicles_status_check CHECK (
  (status = ANY (ARRAY['available'::text, 'full'::text, 'pending'::text, 'rejected'::text]))
);

-- 3. Verify the constraint was updated
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.Vehicles'::regclass
  AND conname = 'Vehicles_status_check';

-- 4. Test: Try to update a vehicle to 'pending' status (replace with actual vehicle ID)
-- UPDATE public.Vehicles 
-- SET status = 'pending' 
-- WHERE id = 'your-vehicle-id-here';

-- 5. Check if any Vehicles need to be updated to 'pending' for testing
SELECT id, title, status 
FROM public.Vehicles 
WHERE status NOT IN ('pending', 'available', 'full');

-- 6. Optional: Update some Vehicles to 'pending' for testing
-- UPDATE public.Vehicles 
-- SET status = 'pending' 
-- WHERE id IN (
--   SELECT id FROM public.Vehicles 
--   WHERE status = 'active' 
--   LIMIT 2
-- );

COMMENT ON COLUMN public.Vehicles.status IS 'vehicle status: pending (awaiting approval), available (approved and available), full (no vacancies), rejected (admin rejected)';
