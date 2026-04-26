-- Check what tables exist in your database
-- Run this first to find the correct table name

-- List all tables in the public schema
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check for common vehicle-related table names
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Vehicles') THEN 'Found: Vehicles'
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'boarding_houses') THEN 'Found: boarding_houses'
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicle') THEN 'Found: vehicle'
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicle') THEN 'Found: vehicle'
        ELSE 'No common vehicle table found'
    END as table_status;










