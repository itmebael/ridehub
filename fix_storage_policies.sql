-- =============================================
-- COMPLETE STORAGE POLICY FIX FOR ALL BUCKETS
-- =============================================
-- Run this SQL in your Supabase Dashboard → SQL Editor
-- This will fix ALL "Storage access denied" errors across the application

-- =============================================
-- TENANT-VERIFICATION BUCKET POLICIES (PRIMARY)
-- =============================================
-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can upload to tenant-verification" ON storage.objects;
DROP POLICY IF EXISTS "Users can update in tenant-verification" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete from tenant-verification" ON storage.objects;
DROP POLICY IF EXISTS "Public can view tenant-verification" ON storage.objects;

-- Allow authenticated users to upload ANY files to tenant-verification bucket
CREATE POLICY "Users can upload to tenant-verification"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tenant-verification');

-- Allow authenticated users to update ANY files in tenant-verification bucket
CREATE POLICY "Users can update in tenant-verification"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'tenant-verification')
WITH CHECK (bucket_id = 'tenant-verification');

-- Allow authenticated users to delete ANY files from tenant-verification bucket
CREATE POLICY "Users can delete from tenant-verification"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'tenant-verification');

-- Allow public read access for tenant-verification bucket
CREATE POLICY "Public can view tenant-verification"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'tenant-verification');

-- =============================================
-- PROFILE-IMAGES BUCKET POLICIES (FALLBACK)
-- =============================================
-- Drop existing policies for profile-images bucket
DROP POLICY IF EXISTS "Users can upload to profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update in profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete from profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view profile-images" ON storage.objects;

-- Allow authenticated users to upload ANY files to profile-images bucket
CREATE POLICY "Users can upload to profile-images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'profile-images');

-- Allow authenticated users to update ANY files in profile-images bucket
CREATE POLICY "Users can update in profile-images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'profile-images')
WITH CHECK (bucket_id = 'profile-images');

-- Allow authenticated users to delete ANY files from profile-images bucket
CREATE POLICY "Users can delete from profile-images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'profile-images');

-- Allow public read access for profile-images bucket
CREATE POLICY "Public can view profile-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'profile-images');

DROP POLICY IF EXISTS "Users can upload to vehicle-images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update in vehicle-images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete from vehicle-images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view vehicle-images" ON storage.objects;

CREATE POLICY "Users can upload to vehicle-images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vehicle-images');

CREATE POLICY "Users can update in vehicle-images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'vehicle-images')
WITH CHECK (bucket_id = 'vehicle-images');

CREATE POLICY "Users can delete from vehicle-images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'vehicle-images');

CREATE POLICY "Public can view vehicle-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'vehicle-images');

-- =============================================
-- ID-DOCUMENTS BUCKET POLICIES (ADDITIONAL)
-- =============================================
-- Drop existing policies for id-documents bucket
DROP POLICY IF EXISTS "Users can upload to id-documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update in id-documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete from id-documents" ON storage.objects;
DROP POLICY IF EXISTS "Public can view id-documents" ON storage.objects;

-- Allow authenticated users to upload ANY files to id-documents bucket
CREATE POLICY "Users can upload to id-documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'id-documents');

-- Allow authenticated users to update ANY files in id-documents bucket
CREATE POLICY "Users can update in id-documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'id-documents')
WITH CHECK (bucket_id = 'id-documents');

-- Allow authenticated users to delete ANY files from id-documents bucket
CREATE POLICY "Users can delete from id-documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'id-documents');

-- Allow public to view ANY files in id-documents bucket
CREATE POLICY "Public can view id-documents" ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'id-documents');

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- Check if policies were created successfully
SELECT 
  schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies 
WHERE tablename = 'objects' 
  AND (policyname LIKE '%profile-images%' OR policyname LIKE '%tenant-verification%')
ORDER BY policyname;

-- Show message when done
SELECT 'Storage policies created successfully! Profile image uploads should now work.' as status;

