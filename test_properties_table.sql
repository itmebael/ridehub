-- Test script to check if Vehicles table exists and has data
-- Run this in your Supabase SQL editor to diagnose the issue

-- 1. Check if the Vehicles table exists
SELECT 
  table_name, 
  table_schema 
FROM information_schema.tables 
WHERE table_name = 'Vehicles';

-- 2. Check table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns 
WHERE table_name = 'Vehicles' 
ORDER BY ordinal_position;

-- 3. Check if there are any Vehicles
SELECT COUNT(*) as total_Vehicles FROM Vehicles;

-- 4. Check Vehicles with their status
SELECT 
  id, 
  title, 
  status, 
  price, 
  location,
  created_at
FROM Vehicles 
ORDER BY created_at DESC;

-- 5. Check only available Vehicles
SELECT 
  id, 
  title, 
  status, 
  price, 
  location
FROM Vehicles 
WHERE status = 'available'
ORDER BY created_at DESC;

-- 6. Check RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'Vehicles';

-- 7. Test basic insert (if you want to add a test vehicle)
-- INSERT INTO Vehicles (
--   title, 
--   description, 
--   price, 
--   location, 
--   amenities, 
--   lat, 
--   lng, 
--   images, 
--   status, 
--   owner_email
-- ) VALUES (
--   'Test vehicle',
--   'This is a test vehicle to verify the table is working',
--   10000,
--   'Test Location',
--   ARRAY['WiFi', 'Parking'],
--   11.7778,
--   124.8847,
--   ARRAY[]::text[],
--   'available',
--   'test@example.com'
-- );


