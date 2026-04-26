-- Fix Vehicles Status Constraint
-- This updates the constraint to allow 'pending' status for admin approval workflow

-- Option 1: Update constraint to allow 'pending' status
-- This allows Vehicles to be created as 'pending' and then approved by admin to 'available'

ALTER TABLE public.Vehicles 
DROP CONSTRAINT IF EXISTS Vehicles_status_check;

ALTER TABLE public.Vehicles 
ADD CONSTRAINT Vehicles_status_check CHECK (
  (status = ANY (ARRAY['available'::text, 'full'::text, 'pending'::text]))
);

-- Verify the constraint was updated
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.Vehicles'::regclass
  AND conname = 'Vehicles_status_check';

-- Test: This should now work
-- INSERT INTO Vehicles (title, description, price, location, lat, lng, status, owner_email)
-- VALUES ('Test vehicle', 'Test Description', 10000, 'Test Location', 11.7778, 124.8847, 'pending', 'test@example.com');



