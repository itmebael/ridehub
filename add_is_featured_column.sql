-- Add is_featured column to Vehicles table
-- This column allows admins to feature/unfeature Vehicles

-- First, check if the Vehicles table exists
-- If you get an error that the table doesn't exist, check your actual table name
-- Common alternatives: boarding_houses, vehicle, vehicle, etc.

-- Option 1: If your table is named "Vehicles" (lowercase)
DO $$
BEGIN
    -- Check if table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Vehicles') THEN
        -- Add the column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'Vehicles' 
            AND column_name = 'is_featured'
        ) THEN
            ALTER TABLE Vehicles ADD COLUMN is_featured BOOLEAN DEFAULT FALSE;
            RAISE NOTICE 'Column is_featured added to Vehicles table';
        ELSE
            RAISE NOTICE 'Column is_featured already exists in Vehicles table';
        END IF;
    ELSE
        RAISE NOTICE 'Table "Vehicles" does not exist. Please check your table name.';
        RAISE NOTICE 'Common table names: Vehicles, boarding_houses, vehicle';
    END IF;
END $$;

-- Create an index for better query performance when filtering featured Vehicles
-- Only create if table and column exist
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'Vehicles' 
        AND column_name = 'is_featured'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_Vehicles_is_featured ON Vehicles(is_featured) WHERE is_featured = TRUE;
        RAISE NOTICE 'Index created for is_featured column';
    END IF;
END $$;

-- Add a comment to the column (if it exists)
COMMENT ON COLUMN Vehicles.is_featured IS 'Indicates if the vehicle is featured/promoted by admin';

-- Alternative: If your table is named "boarding_houses" instead, use this:
/*
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'boarding_houses') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'boarding_houses' 
            AND column_name = 'is_featured'
        ) THEN
            ALTER TABLE boarding_houses ADD COLUMN is_featured BOOLEAN DEFAULT FALSE;
            CREATE INDEX IF NOT EXISTS idx_boarding_houses_is_featured ON boarding_houses(is_featured) WHERE is_featured = TRUE;
            COMMENT ON COLUMN boarding_houses.is_featured IS 'Indicates if the vehicle is featured/promoted by admin';
            RAISE NOTICE 'Column is_featured added to boarding_houses table';
        END IF;
    END IF;
END $$;
*/

