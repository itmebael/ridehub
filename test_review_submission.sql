-- Test script to verify review submission functionality
-- Run this in your Supabase SQL editor to test the reviews table

-- 1. Check if the reviews table exists and its structure
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns 
WHERE table_name = 'reviews' 
ORDER BY ordinal_position;

-- 2. Check if there are any existing reviews
SELECT COUNT(*) as total_reviews FROM reviews;

-- 3. Check RLS policies on reviews table
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
WHERE tablename = 'reviews';

-- 4. Test inserting a sample review (replace with actual vehicle ID)
-- INSERT INTO reviews (vehicle_id, client_email, client_name, rating, review_text, is_verified)
-- VALUES (
--   'your-vehicle-id-here', 
--   'test@example.com', 
--   'Test User', 
--   5, 
--   'This is a test review', 
--   false
-- );

-- 5. Check if the insert would work (without actually inserting)
-- This will show you if there are any constraint violations
SELECT 
  'Test data validation' as test_type,
  CASE 
    WHEN EXISTS (SELECT 1 FROM Vehicles WHERE id = 'your-vehicle-id-here') 
    THEN 'vehicle exists - OK'
    ELSE 'vehicle does not exist - ERROR'
  END as vehicle_check,
  CASE 
    WHEN 'test@example.com' ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    THEN 'Email format valid - OK'
    ELSE 'Email format invalid - ERROR'
  END as email_check,
  CASE 
    WHEN 5 BETWEEN 1 AND 5 
    THEN 'Rating valid - OK'
    ELSE 'Rating invalid - ERROR'
  END as rating_check;

-- 6. Check current user permissions
SELECT 
  current_user as current_user,
  session_user as session_user,
  current_database() as current_database;

-- 7. Check if RLS is enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'reviews';

