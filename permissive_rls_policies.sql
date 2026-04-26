-- Create permissive RLS policies for reviews table
-- This is a more permissive version that should definitely work
-- Run this in your Supabase SQL Editor

-- First, check if the reviews table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'reviews';

-- If the table doesn't exist, create it first
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES Vehicles(id) ON DELETE CASCADE,
    client_email VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
    review_text TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Drop all existing policies
DROP POLICY IF EXISTS "Allow everyone to read reviews" ON reviews;
DROP POLICY IF EXISTS "Allow everyone to insert reviews" ON reviews;
DROP POLICY IF EXISTS "Allow everyone to update reviews" ON reviews;
DROP POLICY IF EXISTS "Allow everyone to delete reviews" ON reviews;
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON reviews;
DROP POLICY IF EXISTS "vehicle owners can see all reviews" ON reviews;
DROP POLICY IF EXISTS "Anyone can insert reviews" ON reviews;
DROP POLICY IF EXISTS "Users can update their own reviews" ON reviews;
DROP POLICY IF EXISTS "Users can delete their own reviews" ON reviews;

-- Option 1: Disable RLS completely (most permissive)
ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;

-- Option 2: If you want to keep RLS enabled, use these very permissive policies
-- ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Very permissive policies (uncomment if you want RLS enabled)
-- CREATE POLICY "Allow all operations on reviews" ON reviews
--     FOR ALL USING (true) WITH CHECK (true);

-- Test the table access
SELECT 'Testing table access...' as status;

-- Try to select from the table
SELECT COUNT(*) as review_count FROM reviews;

-- Try to insert a test record
INSERT INTO reviews (vehicle_id, client_email, client_name, rating, review_text, is_verified)
VALUES (
    (SELECT id FROM Vehicles LIMIT 1),
    'test@example.com',
    'Test User',
    5,
    'Test review for RLS testing',
    false
);

-- Try to read the inserted record
SELECT * FROM reviews WHERE client_email = 'test@example.com';

-- Clean up test data
DELETE FROM reviews WHERE client_email = 'test@example.com';

-- Show final status
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'reviews';

-- Show policies (should be empty if RLS is disabled)
SELECT 
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies 
WHERE tablename = 'reviews';


