-- COMPLETE FIX FOR Vehicles TABLE CONSTRAINTS
-- This SQL will fix ALL constraint issues with the Vehicles table

-- 1. First, check what constraints currently exist on the Vehicles table
SELECT 
  conname AS constraint_name,
  conrelid::regclass AS table_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.Vehicles'::regclass
ORDER BY constraint_name;

-- 2. Drop the status constraint if it exists
ALTER TABLE public.Vehicles 
DROP CONSTRAINT IF EXISTS Vehicles_status_check;

-- 3. Create a new constraint that allows all needed status values
ALTER TABLE public.Vehicles 
ADD CONSTRAINT Vehicles_status_check CHECK (
  (status = ANY (ARRAY['available'::text, 'full'::text, 'pending'::text, 'rejected'::text]))
);

-- 4. Check if is_verified column exists and has proper type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'Vehicles' AND column_name = 'is_verified') THEN
    ALTER TABLE public.Vehicles ADD COLUMN is_verified BOOLEAN DEFAULT false;
  END IF;
END$$;

-- 5. Verify the constraints were updated
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.Vehicles'::regclass
  AND conname = 'Vehicles_status_check';

-- 6. Test: Try to update a vehicle to verify the fix works
-- UPDATE public.Vehicles 
-- SET status = 'pending', is_verified = false
-- WHERE id = 'your-vehicle-id-here';

-- 7. Check the current Vehicles and their statuses
SELECT id, title, status, is_verified 
FROM public.Vehicles 
ORDER BY created_at DESC 
LIMIT 10;

-- 8. Update the comment to reflect all status options
COMMENT ON COLUMN public.Vehicles.status IS 'vehicle status: pending (awaiting approval), available (approved and available), full (no vacancies), rejected (admin rejected)';

-- 9. Optional: Set some Vehicles to pending for testing
-- UPDATE public.Vehicles 
-- SET status = 'pending', is_verified = false
-- WHERE status = 'active'
-- LIMIT 3;

-- 10. Verify the updates worked
SELECT COUNT(*) as pending_count FROM public.Vehicles WHERE status = 'pending';
SELECT COUNT(*) as rejected_count FROM public.Vehicles WHERE status = 'rejected';
