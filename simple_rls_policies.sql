-- Simple RLS Policies for Reviews Table (Quick Setup)
-- Run this in your Supabase SQL Editor for immediate testing

-- Create reviews table if it doesn't exist
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
DROP POLICY IF EXISTS "Anyone can read verified reviews" ON reviews;
DROP POLICY IF EXISTS "vehicle owners can see all their reviews" ON reviews;
DROP POLICY IF EXISTS "Users can see their own reviews" ON reviews;
DROP POLICY IF EXISTS "Anyone can insert reviews" ON reviews;
DROP POLICY IF EXISTS "Users can update their own reviews" ON reviews;
DROP POLICY IF EXISTS "vehicle owners can update their reviews" ON reviews;
DROP POLICY IF EXISTS "Users can delete their own reviews" ON reviews;
DROP POLICY IF EXISTS "vehicle owners can delete their reviews" ON reviews;

-- OPTION 1: Disable RLS completely (Easiest for testing)
ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;

-- OPTION 2: Enable RLS with permissive policies (Uncomment if you want RLS enabled)
-- ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
-- 
-- -- Very permissive policies for testing
-- CREATE POLICY "Allow all operations on reviews" ON reviews
--     FOR ALL USING (true) WITH CHECK (true);

-- Test the setup
SELECT 'Simple RLS setup completed' as status;

-- Check RLS status
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'reviews';

-- Test table access
SELECT COUNT(*) as review_count FROM reviews;

-- Show table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'reviews' 
AND table_schema = 'public'
ORDER BY ordinal_position;


