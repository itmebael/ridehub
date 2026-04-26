-- Fix RLS policies for reviews table
-- Run this in your Supabase SQL Editor

-- First, let's check the current RLS status and policies
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'reviews';

-- Check if RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'reviews';

-- Drop existing policies to start fresh
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON reviews;
DROP POLICY IF EXISTS "vehicle owners can see all reviews" ON reviews;
DROP POLICY IF EXISTS "Anyone can insert reviews" ON reviews;
DROP POLICY IF EXISTS "Users can update their own reviews" ON reviews;
DROP POLICY IF EXISTS "Users can delete their own reviews" ON reviews;

-- Create more permissive policies for testing
-- Policy 1: Allow everyone to read all reviews (for testing)
CREATE POLICY "Allow everyone to read reviews" ON reviews
    FOR SELECT USING (true);

-- Policy 2: Allow everyone to insert reviews (for testing)
CREATE POLICY "Allow everyone to insert reviews" ON reviews
    FOR INSERT WITH CHECK (true);

-- Policy 3: Allow everyone to update reviews (for testing)
CREATE POLICY "Allow everyone to update reviews" ON reviews
    FOR UPDATE USING (true);

-- Policy 4: Allow everyone to delete reviews (for testing)
CREATE POLICY "Allow everyone to delete reviews" ON reviews
    FOR DELETE USING (true);

-- Alternative: Disable RLS temporarily for testing
-- ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;

-- Test the policies by trying to select from reviews
SELECT 'Testing RLS policies...' as status;

-- Check if we can read from reviews table
SELECT COUNT(*) as review_count FROM reviews;

-- Check if we can read the table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'reviews' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Show current policies
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


