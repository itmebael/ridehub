-- ============================================================================
-- SQL Alterations for rental and Review Enhancements
-- Run this script in your Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. ENSURE Rentals TABLE HAS ALL REQUIRED COLUMNS
-- ============================================================================

-- Add missing columns to Rentals table if they don't exist
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Rentals') THEN
        -- Full Name (required)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'full_name') THEN
            ALTER TABLE Rentals ADD COLUMN full_name VARCHAR(255);
            -- Migrate from client_name if it exists
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_name') THEN
                UPDATE Rentals SET full_name = client_name WHERE full_name IS NULL;
            END IF;
        END IF;
        
        -- Address fields (required)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'address') THEN
            ALTER TABLE Rentals ADD COLUMN address TEXT;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'barangay') THEN
            ALTER TABLE Rentals ADD COLUMN barangay VARCHAR(100);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'municipality_city') THEN
            ALTER TABLE Rentals ADD COLUMN municipality_city VARCHAR(100);
        END IF;
        
        -- Personal information (required)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'gender') THEN
            ALTER TABLE Rentals ADD COLUMN gender VARCHAR(20);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'age') THEN
            ALTER TABLE Rentals ADD COLUMN age INTEGER;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'citizenship') THEN
            ALTER TABLE Rentals ADD COLUMN citizenship VARCHAR(20);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'occupation_status') THEN
            ALTER TABLE Rentals ADD COLUMN occupation_status VARCHAR(20);
        END IF;
        
        -- Tenant email (for linking to reviews)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
            ALTER TABLE Rentals ADD COLUMN tenant_email VARCHAR(255);
            -- Migrate from client_email if it exists
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_email') THEN
                UPDATE Rentals SET tenant_email = client_email WHERE tenant_email IS NULL;
            END IF;
        END IF;
        
        -- Room and Bed selection
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'room_id') THEN
            ALTER TABLE Rentals ADD COLUMN room_id UUID;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'bed_id') THEN
            ALTER TABLE Rentals ADD COLUMN bed_id UUID;
        END IF;
        
        -- Status column (ensure it exists and has 'approved' option)
        -- Note: Status constraint with 'approved' option is handled by the CHECK constraint in the main schema
        -- No action needed here as the constraint is managed by the main schema file
    END IF;
END $$;

-- ============================================================================
-- 2. ENSURE REVIEWS TABLE HAS rental_id COLUMN
-- ============================================================================

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reviews') THEN
        -- Add rental_id if missing (critical for review eligibility check)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'rental_id') THEN
            ALTER TABLE reviews ADD COLUMN rental_id UUID;
        END IF;
        
        -- Add foreign key constraint if it doesn't exist
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'rental_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'reviews_rental_id_fkey' 
                AND table_name = 'reviews'
            ) THEN
                ALTER TABLE reviews 
                ADD CONSTRAINT reviews_rental_id_fkey 
                FOREIGN KEY (rental_id) REFERENCES Rentals(id) ON DELETE CASCADE;
            END IF;
        END IF;
        
        -- Create index for rental_id if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE tablename = 'reviews' 
            AND indexname = 'idx_reviews_rental'
        ) THEN
            CREATE INDEX idx_reviews_rental ON reviews(rental_id);
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 3. ENSURE Vehicles TABLE HAS total_Rentals COLUMN (for Most Booked feature)
-- ============================================================================

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
        -- Add total_Rentals column if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Vehicles' AND column_name = 'total_Rentals') THEN
            ALTER TABLE Vehicles ADD COLUMN total_Rentals INTEGER DEFAULT 0;
            
            -- Initialize total_Rentals from existing approved Rentals
            UPDATE Vehicles 
            SET total_Rentals = (
                SELECT COUNT(*) 
                FROM Rentals 
                WHERE (Rentals.vehicle_id = Vehicles.id OR Rentals.boarding_house_id = Vehicles.id)
                AND Rentals.status = 'approved'
            );
        END IF;
        
        -- Create index for sorting by total_Rentals
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE tablename = 'Vehicles' 
            AND indexname = 'idx_Vehicles_total_Rentals'
        ) THEN
            CREATE INDEX idx_Vehicles_total_Rentals ON Vehicles(total_Rentals DESC);
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 4. CREATE/UPDATE TRIGGER TO UPDATE total_Rentals WHEN rental IS APPROVED
-- ============================================================================

-- Function to update vehicle total_Rentals when rental status changes
CREATE OR REPLACE FUNCTION update_vehicle_total_Rentals()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT: When a new rental is created with approved status
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'approved' THEN
            -- Update Vehicles table total_Rentals
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
                UPDATE Vehicles 
                SET total_Rentals = COALESCE(total_Rentals, 0) + 1
                WHERE id = COALESCE(NEW.vehicle_id, NEW.boarding_house_id);
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    
    -- Handle UPDATE: When rental status changes
    IF TG_OP = 'UPDATE' THEN
        -- When rental is approved (wasn't approved before)
        IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
            -- Update Vehicles table total_Rentals
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
                UPDATE Vehicles 
                SET total_Rentals = COALESCE(total_Rentals, 0) + 1
                WHERE id = COALESCE(NEW.vehicle_id, NEW.boarding_house_id);
            END IF;
        END IF;
        
        -- When rental approval is revoked (rejected/cancelled after being approved)
        IF OLD.status = 'approved' AND NEW.status IN ('rejected', 'cancelled') THEN
            -- Decrease total_Rentals
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
                UPDATE Vehicles 
                SET total_Rentals = GREATEST(COALESCE(total_Rentals, 0) - 1, 0)
                WHERE id = COALESCE(OLD.vehicle_id, OLD.boarding_house_id);
            END IF;
        END IF;
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger (no WHEN clause - logic handled inside function)
DROP TRIGGER IF EXISTS update_vehicle_total_Rentals_trigger ON Rentals;
CREATE TRIGGER update_vehicle_total_Rentals_trigger
    AFTER INSERT OR UPDATE ON Rentals
    FOR EACH ROW 
    EXECUTE FUNCTION update_vehicle_total_Rentals();

-- ============================================================================
-- 5. CREATE/UPDATE TRIGGER TO VERIFY REVIEW ELIGIBILITY (Approved rental Required)
-- ============================================================================

-- Function to verify review can only be submitted for approved Rentals
CREATE OR REPLACE FUNCTION verify_review_eligibility()
RETURNS TRIGGER AS $$
BEGIN
    -- If rental_id is provided, verify the rental is approved
    -- This enforces the requirement that reviews can only be written for approved Rentals
    IF NEW.rental_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM Rentals 
            WHERE id = NEW.rental_id 
            AND status = 'approved'
        ) THEN
            RAISE EXCEPTION 'Review can only be submitted for approved Rentals. Your rental must be approved by the landlord before you can write a review.';
        END IF;
        
        -- Mark review as verified since rental is approved
        NEW.is_verified = TRUE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS verify_review_eligibility_trigger ON reviews;
CREATE TRIGGER verify_review_eligibility_trigger
    BEFORE INSERT ON reviews
    FOR EACH ROW EXECUTE FUNCTION verify_review_eligibility();

-- ============================================================================
-- 6. ADD CHECK CONSTRAINTS FOR rental FORM FIELDS
-- ============================================================================

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Rentals') THEN
        -- Add citizenship check constraint if column exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'citizenship') THEN
            -- Drop existing constraint if it exists
            ALTER TABLE Rentals DROP CONSTRAINT IF EXISTS Rentals_citizenship_check;
            -- Add new constraint
            ALTER TABLE Rentals ADD CONSTRAINT Rentals_citizenship_check 
                CHECK (citizenship IN ('Filipino', 'Foreigner') OR citizenship IS NULL);
        END IF;
        
        -- Add occupation_status check constraint if column exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'occupation_status') THEN
            -- Drop existing constraint if it exists
            ALTER TABLE Rentals DROP CONSTRAINT IF EXISTS Rentals_occupation_status_check;
            -- Add new constraint
            ALTER TABLE Rentals ADD CONSTRAINT Rentals_occupation_status_check 
                CHECK (occupation_status IN ('Student', 'Worker') OR occupation_status IS NULL);
        END IF;
        
        -- Ensure status includes 'approved'
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'status') THEN
            -- Drop existing constraint if it exists
            ALTER TABLE Rentals DROP CONSTRAINT IF EXISTS Rentals_status_check;
            -- Add new constraint with 'approved' status
            ALTER TABLE Rentals ADD CONSTRAINT Rentals_status_check 
                CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed') OR status IS NULL);
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 7. VERIFY ALL CHANGES
-- ============================================================================

-- Check Rentals table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'Rentals' 
AND column_name IN (
    'full_name', 'address', 'barangay', 'municipality_city', 
    'gender', 'age', 'citizenship', 'occupation_status', 
    'tenant_email', 'room_id', 'bed_id', 'status'
)
ORDER BY ordinal_position;

-- Check reviews table has rental_id
SELECT 
    column_name, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'reviews' 
AND column_name = 'rental_id';

-- Check Vehicles table has total_Rentals
SELECT 
    column_name, 
    data_type,
    column_default
FROM information_schema.columns 
WHERE table_name = 'Vehicles' 
AND column_name = 'total_Rentals';

-- Check triggers exist
SELECT 
    trigger_name, 
    event_manipulation, 
    event_object_table
FROM information_schema.triggers 
WHERE trigger_name IN (
    'update_vehicle_total_Rentals_trigger',
    'verify_review_eligibility_trigger'
);

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================


