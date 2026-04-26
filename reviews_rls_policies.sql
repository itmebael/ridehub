-- RLS (Row Level Security) Policies for Reviews Table
-- Run this in your Supabase SQL Editor

-- First, ensure the reviews table exists
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

-- Enable Row Level Security
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to start fresh
DROP POLICY IF EXISTS "Allow everyone to read reviews" ON reviews;
DROP POLICY IF EXISTS "Allow everyone to insert reviews" ON reviews;
DROP POLICY IF EXISTS "Allow everyone to update reviews" ON reviews;
DROP POLICY IF EXISTS "Allow everyone to delete reviews" ON reviews;
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON reviews;
DROP POLICY IF EXISTS "vehicle owners can see all reviews" ON reviews;
DROP POLICY IF EXISTS "Anyone can insert reviews" ON reviews;
DROP POLICY IF EXISTS "Users can update their own reviews" ON reviews;
DROP POLICY IF EXISTS "Users can delete their own reviews" ON reviews;
DROP POLICY IF EXISTS "Allow all operations on reviews" ON reviews;

-- ========================================
-- RLS POLICIES FOR REVIEWS TABLE
-- ========================================

-- 1. SELECT Policy - Who can read reviews
-- Allow everyone to read verified reviews
CREATE POLICY "Anyone can read verified reviews" ON reviews
    FOR SELECT USING (is_verified = true);

-- Allow vehicle owners to see all reviews for their Vehicles
CREATE POLICY "vehicle owners can see all their reviews" ON reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM Vehicles 
            WHERE Vehicles.id = reviews.vehicle_id 
            AND Vehicles.owner_email = auth.jwt() ->> 'email'
        )
    );

-- Allow users to see their own reviews
CREATE POLICY "Users can see their own reviews" ON reviews
    FOR SELECT USING (client_email = auth.jwt() ->> 'email');

-- 2. INSERT Policy - Who can create reviews
-- Allow anyone to insert reviews (they will be unverified by default)
CREATE POLICY "Anyone can insert reviews" ON reviews
    FOR INSERT WITH CHECK (true);

-- 3. UPDATE Policy - Who can update reviews
-- Allow users to update their own reviews
CREATE POLICY "Users can update their own reviews" ON reviews
    FOR UPDATE USING (client_email = auth.jwt() ->> 'email')
    WITH CHECK (client_email = auth.jwt() ->> 'email');

-- Allow vehicle owners to update reviews for their Vehicles (for admin purposes)
CREATE POLICY "vehicle owners can update their reviews" ON reviews
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM Vehicles 
            WHERE Vehicles.id = reviews.vehicle_id 
            AND Vehicles.owner_email = auth.jwt() ->> 'email'
        )
    );

-- 4. DELETE Policy - Who can delete reviews
-- Allow users to delete their own reviews
CREATE POLICY "Users can delete their own reviews" ON reviews
    FOR DELETE USING (client_email = auth.jwt() ->> 'email');

-- Allow vehicle owners to delete reviews for their Vehicles
CREATE POLICY "vehicle owners can delete their reviews" ON reviews
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM Vehicles 
            WHERE Vehicles.id = reviews.vehicle_id 
            AND Vehicles.owner_email = auth.jwt() ->> 'email'
        )
    );

-- ========================================
-- ALTERNATIVE: PERMISSIVE POLICIES (FOR TESTING)
-- ========================================
-- Uncomment these if you want more permissive access for testing

-- -- Disable RLS completely (most permissive)
-- ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;

-- -- OR use very permissive policies
-- CREATE POLICY "Allow all operations on reviews" ON reviews
--     FOR ALL USING (true) WITH CHECK (true);

-- ========================================
-- VERIFY RLS SETUP
-- ========================================

-- Check if RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'reviews';

-- Show all policies
SELECT 
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'reviews'
ORDER BY policyname;

-- Test the policies
SELECT 'RLS setup completed. Testing policies...' as status;

-- Try to select from reviews (should work if RLS is properly configured)
SELECT COUNT(*) as review_count FROM reviews;

-- Show table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'reviews' 
AND table_schema = 'public'
ORDER BY ordinal_position;


