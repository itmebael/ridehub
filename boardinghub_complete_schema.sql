-- ============================================================================
-- BoardingHub Complete Database Schema
-- Modern boarding house rental platform with comprehensive features
-- ============================================================================

-- ============================================================================
-- MIGRATION: Handle existing schema compatibility
-- ============================================================================

-- Check if old 'Vehicles' table exists and create mapping
DO $$ 
BEGIN
    -- If 'Vehicles' table exists but 'boarding_houses' doesn't, create a view mapping
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'boarding_houses') THEN
        -- Create a view that maps Vehicles to boarding_houses structure
        EXECUTE '
        CREATE OR REPLACE VIEW boarding_houses AS
        SELECT 
            id,
            owner_id as landlord_id,
            COALESCE(owner_email, '''') as landlord_email,
            title as name,
            description,
            location as address,
            NULL::VARCHAR(100) as barangay,
            NULL::VARCHAR(100) as municipality_city,
            NULL::VARCHAR(100) as province,
            lat,
            lng,
            price::DECIMAL(10,2) as price_per_bed,
            amenities,
            NULL::TEXT as house_rules,
            NULL::VARCHAR(20) as contact_phone,
            owner_email as contact_email,
            CASE 
                WHEN status = ''available'' THEN ''active''
                WHEN status = ''full'' THEN ''inactive''
                WHEN status = ''pending'' THEN ''pending''
                ELSE ''pending''
            END as status,
            COALESCE(rating, 0.0) as rating,
            COALESCE(total_reviews, 0) as total_reviews,
            0 as total_Rentals,
            FALSE as is_featured,
            NULL::TEXT as admin_notes,
            created_at,
            created_at as updated_at
        FROM Vehicles';
    END IF;
END $$;

-- Migrate old Rentals structure to new structure
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Rentals') THEN
        -- Check if this is the old schema (has vehicle_id, client_name, etc.)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'vehicle_id')
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_name') THEN
            -- Map old columns to new columns
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'boarding_house_id') THEN
                ALTER TABLE Rentals ADD COLUMN boarding_house_id UUID;
                UPDATE Rentals SET boarding_house_id = vehicle_id WHERE boarding_house_id IS NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'full_name') THEN
                ALTER TABLE Rentals ADD COLUMN full_name VARCHAR(255);
                UPDATE Rentals SET full_name = client_name WHERE full_name IS NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
                ALTER TABLE Rentals ADD COLUMN tenant_email VARCHAR(255);
                UPDATE Rentals SET tenant_email = client_email WHERE tenant_email IS NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'special_requests') THEN
                ALTER TABLE Rentals ADD COLUMN special_requests TEXT;
                UPDATE Rentals SET special_requests = message WHERE special_requests IS NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'total_amount') THEN
                ALTER TABLE Rentals ADD COLUMN total_amount DECIMAL(10,2) DEFAULT 0;
            END IF;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 1. USERS & AUTHENTICATION
-- ============================================================================

-- User roles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('tenant', 'landlord', 'admin')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role)
);

-- ============================================================================
-- 2. USER PROFILES (General user profiles - for backward compatibility)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(20),
    address TEXT,
    barangay VARCHAR(100),
    municipality_city VARCHAR(100),
    province VARCHAR(100),
    profile_image_url TEXT,
    bio TEXT,
    preferences JSONB,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns to user_profiles if table already exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles') THEN
        -- Add address if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'address') THEN
            ALTER TABLE user_profiles ADD COLUMN address TEXT;
        END IF;
        -- Add barangay if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'barangay') THEN
            ALTER TABLE user_profiles ADD COLUMN barangay VARCHAR(100);
        END IF;
        -- Add municipality_city if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'municipality_city') THEN
            ALTER TABLE user_profiles ADD COLUMN municipality_city VARCHAR(100);
        END IF;
        -- Add province if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'province') THEN
            ALTER TABLE user_profiles ADD COLUMN province VARCHAR(100);
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 3. LANDLORD PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS landlord_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    profile_image_url TEXT,
    bio TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected')),
    verification_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 3. BOARDING HOUSE PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS boarding_houses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    landlord_id UUID REFERENCES landlord_profiles(id) ON DELETE CASCADE,
    landlord_email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    address TEXT NOT NULL,
    barangay VARCHAR(100),
    municipality_city VARCHAR(100),
    province VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    price_per_bed DECIMAL(10,2) NOT NULL,
    amenities TEXT[] DEFAULT '{}'::text[],
    house_rules TEXT,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'suspended')),
    rating DECIMAL(3,2) DEFAULT 0.0 CHECK (rating >= 0 AND rating <= 5),
    total_reviews INTEGER DEFAULT 0,
    total_Rentals INTEGER DEFAULT 0, -- For priority listing
    is_featured BOOLEAN DEFAULT FALSE,
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 4. LANDLORD PERMITS
-- ============================================================================

CREATE TABLE IF NOT EXISTS landlord_permits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    landlord_id UUID REFERENCES landlord_profiles(id) ON DELETE CASCADE,
    boarding_house_id UUID, -- FK constraint added separately (only if boarding_houses is a table)
    vehicle_id UUID, -- Fallback for old schema
    permit_type VARCHAR(50) NOT NULL CHECK (permit_type IN ('business_permit', 'boarding_house_permit')),
    permit_number VARCHAR(100),
    permit_file_url TEXT NOT NULL,
    expiry_date DATE,
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected', 'expired')),
    verified_by UUID REFERENCES auth.users(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 6. ROOMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boarding_house_id UUID, -- FK constraint added separately
    vehicle_id UUID, -- Fallback for old schema
    room_number VARCHAR(50) NOT NULL,
    room_name VARCHAR(255),
    description TEXT,
    max_beds INTEGER NOT NULL DEFAULT 1,
    current_occupancy INTEGER DEFAULT 0,
    price_per_bed DECIMAL(10,2),
    amenities TEXT[] DEFAULT '{}'::text[],
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'full', 'maintenance')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add UNIQUE constraint conditionally
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'boarding_house_id') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'rooms_boarding_house_room_unique' 
            AND table_name = 'rooms'
        ) THEN
            ALTER TABLE rooms ADD CONSTRAINT rooms_boarding_house_room_unique UNIQUE(boarding_house_id, room_number);
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'vehicle_id') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'rooms_vehicle_room_unique' 
            AND table_name = 'rooms'
        ) THEN
            ALTER TABLE rooms ADD CONSTRAINT rooms_vehicle_room_unique UNIQUE(vehicle_id, room_number);
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 7. BEDS (Supports Single and Double-Deck Beds)
-- ============================================================================

CREATE TABLE IF NOT EXISTS beds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID, -- FK constraint added separately
    bed_number VARCHAR(50) NOT NULL,
    bed_type VARCHAR(20) NOT NULL CHECK (bed_type IN ('single', 'double_deck_upper', 'double_deck_lower')),
    parent_bed_id UUID REFERENCES beds(id) ON DELETE CASCADE, -- For linking upper/lower decks to the base bed
    partner_bed_id UUID REFERENCES beds(id) ON DELETE SET NULL, -- For linking upper to lower (and vice versa)
    deck_position VARCHAR(10) CHECK (deck_position IN ('upper', 'lower', NULL)), -- Explicit position for double-deck beds
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance')),
    price DECIMAL(10,2),
    notes TEXT, -- Additional notes about the bed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns to beds if table already exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'beds') THEN
        -- Add partner_bed_id if missing (for linking upper/lower decks)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'partner_bed_id') THEN
            ALTER TABLE beds ADD COLUMN partner_bed_id UUID;
        END IF;
        -- Add deck_position if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'deck_position') THEN
            ALTER TABLE beds ADD COLUMN deck_position VARCHAR(10);
            -- Update existing double-deck beds to have deck_position
            UPDATE beds SET deck_position = 'upper' WHERE bed_type = 'double_deck_upper' AND deck_position IS NULL;
            UPDATE beds SET deck_position = 'lower' WHERE bed_type = 'double_deck_lower' AND deck_position IS NULL;
        END IF;
        -- Add notes if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'notes') THEN
            ALTER TABLE beds ADD COLUMN notes TEXT;
        END IF;
    END IF;
END $$;

-- Add foreign key constraint for partner_bed_id if column exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'partner_bed_id') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'beds_partner_bed_id_fkey' 
            AND table_name = 'beds'
        ) THEN
            ALTER TABLE beds ADD CONSTRAINT beds_partner_bed_id_fkey 
                FOREIGN KEY (partner_bed_id) REFERENCES beds(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

-- Add UNIQUE constraint for beds conditionally
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'room_id') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'beds_room_bed_unique' 
            AND table_name = 'beds'
        ) THEN
            ALTER TABLE beds ADD CONSTRAINT beds_room_bed_unique UNIQUE(room_id, bed_number);
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 8. vehicle IMAGES (Categorized: CR and Available Rooms)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boarding_house_id UUID, -- FK constraint added separately
    vehicle_id UUID, -- Fallback for old schema
    room_id UUID, -- FK constraint added separately
    image_url TEXT NOT NULL,
    image_category VARCHAR(50) NOT NULL CHECK (image_category IN ('comfort_room', 'available_room', 'common_area', 'exterior', 'other')),
    display_order INTEGER DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 9. TENANT PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    barangay VARCHAR(100),
    municipality_city VARCHAR(100),
    gender VARCHAR(20),
    age INTEGER,
    citizenship VARCHAR(20) CHECK (citizenship IN ('Filipino', 'Foreigner')),
    occupation_status VARCHAR(20) CHECK (occupation_status IN ('Student', 'Worker')),
    profile_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 10. Rentals (With Complete Form Data)
-- ============================================================================

-- Add missing columns if Rentals table exists (handle old schema migration)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Rentals') THEN
        -- Check if this is the old schema (has vehicle_id, client_name, etc.)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'vehicle_id')
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_name') THEN
            -- Migrate old Rentals structure
            -- Add new columns
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'boarding_house_id') THEN
                ALTER TABLE Rentals ADD COLUMN boarding_house_id UUID;
                -- Copy vehicle_id to boarding_house_id
                UPDATE Rentals SET boarding_house_id = vehicle_id WHERE boarding_house_id IS NULL;
            END IF;
            -- Map client_name to full_name
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'full_name') THEN
                ALTER TABLE Rentals ADD COLUMN full_name VARCHAR(255);
                UPDATE Rentals SET full_name = client_name WHERE full_name IS NULL;
            END IF;
            -- Map client_email to tenant_email (if not exists)
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
                ALTER TABLE Rentals ADD COLUMN tenant_email VARCHAR(255);
                UPDATE Rentals SET tenant_email = client_email WHERE tenant_email IS NULL;
            END IF;
            -- Map message to special_requests
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'special_requests') THEN
                ALTER TABLE Rentals ADD COLUMN special_requests TEXT;
                UPDATE Rentals SET special_requests = message WHERE special_requests IS NULL;
            END IF;
        END IF;
        -- Add tenant_id if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_id') THEN
            ALTER TABLE Rentals ADD COLUMN tenant_id UUID;
        END IF;
        -- Add boarding_house_id if missing (for new schema)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'boarding_house_id') THEN
            ALTER TABLE Rentals ADD COLUMN boarding_house_id UUID;
        END IF;
        -- Ensure vehicle_id exists (for old schema compatibility)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'vehicle_id') THEN
            ALTER TABLE Rentals ADD COLUMN vehicle_id UUID;
        END IF;
        -- Add room_id if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'room_id') THEN
            ALTER TABLE Rentals ADD COLUMN room_id UUID;
        END IF;
        -- Add bed_id if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'bed_id') THEN
            ALTER TABLE Rentals ADD COLUMN bed_id UUID;
        END IF;
        -- Add tenant_email if missing (critical column - add for all Rentals tables)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
            ALTER TABLE Rentals ADD COLUMN tenant_email VARCHAR(255);
            -- Try to populate from client_email if it exists
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_email') THEN
                UPDATE Rentals SET tenant_email = client_email WHERE tenant_email IS NULL;
            END IF;
        END IF;
        -- Add rental form fields if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'full_name') THEN
            ALTER TABLE Rentals ADD COLUMN full_name VARCHAR(255);
            -- Try to populate from client_name if it exists
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_name') THEN
                UPDATE Rentals SET full_name = client_name WHERE full_name IS NULL;
            END IF;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'address') THEN
            ALTER TABLE Rentals ADD COLUMN address TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'barangay') THEN
            ALTER TABLE Rentals ADD COLUMN barangay VARCHAR(100);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'municipality_city') THEN
            ALTER TABLE Rentals ADD COLUMN municipality_city VARCHAR(100);
        END IF;
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
        -- Add rental dates if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'check_in_date') THEN
            ALTER TABLE Rentals ADD COLUMN check_in_date DATE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'check_out_date') THEN
            ALTER TABLE Rentals ADD COLUMN check_out_date DATE;
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS Rentals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    tenant_email VARCHAR(255), -- NOT NULL constraint added separately if column exists
    boarding_house_id UUID, -- Will add FK constraint separately if table exists
    vehicle_id UUID, -- Fallback for old schema
    room_id UUID, -- Will add FK constraint separately if table exists
    bed_id UUID, -- Will add FK constraint separately if table exists
    
    -- rental Form Data (Required Fields)
    full_name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    barangay VARCHAR(100) NOT NULL,
    municipality_city VARCHAR(100) NOT NULL,
    gender VARCHAR(20) NOT NULL,
    age INTEGER NOT NULL,
    citizenship VARCHAR(20) NOT NULL CHECK (citizenship IN ('Filipino', 'Foreigner')),
    occupation_status VARCHAR(20) NOT NULL CHECK (occupation_status IN ('Student', 'Worker')),
    
    -- rental Details
    check_in_date DATE,
    check_out_date DATE,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'partial', 'refunded')),
    special_requests TEXT,
    
    -- Approval Details
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    
    -- Admin Notes
    admin_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key constraints conditionally
DO $$ 
BEGIN
    -- Add tenant_id FK if tenant_profiles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_profiles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'Rentals_tenant_id_fkey' 
                AND table_name = 'Rentals'
            ) THEN
                ALTER TABLE Rentals 
                ADD CONSTRAINT Rentals_tenant_id_fkey 
                FOREIGN KEY (tenant_id) REFERENCES tenant_profiles(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;
    
    -- Add boarding_house_id FK if boarding_houses exists as a TABLE (not view) AND column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'boarding_house_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'Rentals_boarding_house_id_fkey' 
                AND table_name = 'Rentals'
            ) THEN
                ALTER TABLE Rentals 
                ADD CONSTRAINT Rentals_boarding_house_id_fkey 
                FOREIGN KEY (boarding_house_id) REFERENCES boarding_houses(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
    
    -- Add room_id FK if rooms exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rooms') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'room_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'Rentals_room_id_fkey' 
                AND table_name = 'Rentals'
            ) THEN
                ALTER TABLE Rentals 
                ADD CONSTRAINT Rentals_room_id_fkey 
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;
    
    -- Add bed_id FK if beds exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'beds') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'bed_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'Rentals_bed_id_fkey' 
                AND table_name = 'Rentals'
            ) THEN
                ALTER TABLE Rentals 
                ADD CONSTRAINT Rentals_bed_id_fkey 
                FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;
    
    -- Add FK constraints for rooms if boarding_houses exists as a TABLE (not view) AND column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'boarding_house_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'rooms_boarding_house_id_fkey' 
                AND table_name = 'rooms'
            ) THEN
                ALTER TABLE rooms 
                ADD CONSTRAINT rooms_boarding_house_id_fkey 
                FOREIGN KEY (boarding_house_id) REFERENCES boarding_houses(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
    
    -- Add FK constraints for beds if rooms exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rooms') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'room_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'beds_room_id_fkey' 
                AND table_name = 'beds'
            ) THEN
                ALTER TABLE beds 
                ADD CONSTRAINT beds_room_id_fkey 
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
    
    -- Add FK constraints for vehicle_images if boarding_houses exists as a TABLE (not view) AND column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'boarding_house_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'vehicle_images_boarding_house_id_fkey' 
                AND table_name = 'vehicle_images'
            ) THEN
                ALTER TABLE vehicle_images 
                ADD CONSTRAINT vehicle_images_boarding_house_id_fkey 
                FOREIGN KEY (boarding_house_id) REFERENCES boarding_houses(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rooms') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'room_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'vehicle_images_room_id_fkey' 
                AND table_name = 'vehicle_images'
            ) THEN
                ALTER TABLE vehicle_images 
                ADD CONSTRAINT vehicle_images_room_id_fkey 
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;
    
    -- Add FK constraint for rental_analytics if boarding_houses exists as a TABLE (not view) AND column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rental_analytics' AND column_name = 'boarding_house_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'rental_analytics_boarding_house_id_fkey' 
                AND table_name = 'rental_analytics'
            ) THEN
                ALTER TABLE rental_analytics 
                ADD CONSTRAINT rental_analytics_boarding_house_id_fkey 
                FOREIGN KEY (boarding_house_id) REFERENCES boarding_houses(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
    
    -- Add FK constraint for landlord_permits if boarding_houses exists as a TABLE (not view) AND column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'landlord_permits' AND column_name = 'boarding_house_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'landlord_permits_boarding_house_id_fkey' 
                AND table_name = 'landlord_permits'
            ) THEN
                ALTER TABLE landlord_permits 
                ADD CONSTRAINT landlord_permits_boarding_house_id_fkey 
                FOREIGN KEY (boarding_house_id) REFERENCES boarding_houses(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 11. REVIEWS (Only After rental Approval)
-- ============================================================================

-- Add missing columns if reviews table exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reviews') THEN
        -- Add rental_id if missing (critical column)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'rental_id') THEN
            ALTER TABLE reviews ADD COLUMN rental_id UUID;
        END IF;
        -- Add tenant_id if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_id') THEN
            ALTER TABLE reviews ADD COLUMN tenant_id UUID;
        END IF;
        -- Add boarding_house_id if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'boarding_house_id') THEN
            ALTER TABLE reviews ADD COLUMN boarding_house_id UUID;
        END IF;
        -- Ensure vehicle_id exists (for old schema compatibility)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'vehicle_id') THEN
            ALTER TABLE reviews ADD COLUMN vehicle_id UUID;
        END IF;
        -- Add is_verified if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'is_verified') THEN
            ALTER TABLE reviews ADD COLUMN is_verified BOOLEAN DEFAULT FALSE;
        END IF;
        -- Add is_visible if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'is_visible') THEN
            ALTER TABLE reviews ADD COLUMN is_visible BOOLEAN DEFAULT TRUE;
        END IF;
        -- Add tenant_email if missing (critical column)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_email') THEN
            ALTER TABLE reviews ADD COLUMN tenant_email VARCHAR(255);
            -- Try to populate from Rentals if possible
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
                UPDATE reviews SET tenant_email = (
                    SELECT tenant_email FROM Rentals WHERE Rentals.id = reviews.rental_id
                ) WHERE tenant_email IS NULL AND rental_id IS NOT NULL;
            ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_email') THEN
                UPDATE reviews SET tenant_email = (
                    SELECT client_email FROM Rentals WHERE Rentals.id = reviews.rental_id
                ) WHERE tenant_email IS NULL AND rental_id IS NOT NULL;
            END IF;
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID, -- FK constraint added separately
    tenant_id UUID,
    tenant_email VARCHAR(255), -- NOT NULL constraint added separately if column exists
    boarding_house_id UUID, -- Will add FK constraint separately if table exists
    vehicle_id UUID, -- Fallback for old schema
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    is_verified BOOLEAN DEFAULT FALSE, -- Verified if rental was approved
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add UNIQUE constraint for reviews (only one review per rental) conditionally
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'rental_id') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'reviews_rental_id_unique' 
            AND table_name = 'reviews'
        ) THEN
            ALTER TABLE reviews ADD CONSTRAINT reviews_rental_id_unique UNIQUE(rental_id);
        END IF;
    END IF;
END $$;

-- Add foreign key constraints for reviews conditionally
DO $$ 
BEGIN
    -- Add rental_id FK if Rentals exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Rentals') THEN
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
    END IF;
    
    -- Add tenant_id FK if tenant_profiles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_profiles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'reviews_tenant_id_fkey' 
                AND table_name = 'reviews'
            ) THEN
                ALTER TABLE reviews 
                ADD CONSTRAINT reviews_tenant_id_fkey 
                FOREIGN KEY (tenant_id) REFERENCES tenant_profiles(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;
    
    -- Add boarding_house_id FK if boarding_houses exists as a TABLE (not view) AND column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'boarding_house_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'reviews_boarding_house_id_fkey' 
                AND table_name = 'reviews'
            ) THEN
                ALTER TABLE reviews 
                ADD CONSTRAINT reviews_boarding_house_id_fkey 
                FOREIGN KEY (boarding_house_id) REFERENCES boarding_houses(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
END $$;

-- Note: Reviews can only be submitted if rental is approved
-- This is enforced via the verify_review_eligibility() trigger function below
-- (PostgreSQL CHECK constraints cannot contain subqueries)

-- ============================================================================
-- 12. ANALYTICS & REPORTING
-- ============================================================================

-- rental Analytics (for priority listing)
CREATE TABLE IF NOT EXISTS rental_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boarding_house_id UUID, -- FK constraint added separately (only if boarding_houses is a table)
    vehicle_id UUID, -- Fallback for old schema
    date DATE NOT NULL,
    total_Rentals INTEGER DEFAULT 0,
    approved_Rentals INTEGER DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0.0,
    occupancy_rate DECIMAL(5,2) DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(boarding_house_id, date)
);

-- Admin Reports (for report generation module)
CREATE TABLE IF NOT EXISTS admin_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('Rentals', 'landlords', 'tenants', 'revenue', 'custom')),
    filters JSONB, -- Store filter criteria (boarding_house_id, date_range, etc.)
    generated_by UUID REFERENCES auth.users(id),
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    file_url TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed'))
);

-- ============================================================================
-- 13. INDEXES FOR PERFORMANCE
-- ============================================================================

-- User roles indexes
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_email ON user_roles(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- User profiles indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(user_email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_verified ON user_profiles(is_verified);
-- Only create municipality index if column exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'municipality_city') THEN
        CREATE INDEX IF NOT EXISTS idx_user_profiles_municipality ON user_profiles(municipality_city);
    END IF;
END $$;

-- Landlord profiles indexes
CREATE INDEX IF NOT EXISTS idx_landlord_profiles_user_id ON landlord_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_landlord_profiles_email ON landlord_profiles(email);
CREATE INDEX IF NOT EXISTS idx_landlord_profiles_verification ON landlord_profiles(verification_status);

-- Boarding houses indexes (only if boarding_houses is a table, not a view)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_boarding_houses_landlord ON boarding_houses(landlord_id);
        CREATE INDEX IF NOT EXISTS idx_boarding_houses_status ON boarding_houses(status);
        CREATE INDEX IF NOT EXISTS idx_boarding_houses_rating ON boarding_houses(rating DESC);
        CREATE INDEX IF NOT EXISTS idx_boarding_houses_Rentals ON boarding_houses(total_Rentals DESC); -- For priority listing
        CREATE INDEX IF NOT EXISTS idx_boarding_houses_location ON boarding_houses(lat, lng);
        CREATE INDEX IF NOT EXISTS idx_boarding_houses_featured ON boarding_houses(is_featured);
    END IF;
END $$;

-- Permits indexes
CREATE INDEX IF NOT EXISTS idx_permits_landlord ON landlord_permits(landlord_id);
-- Only create boarding_house_id index if column exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'landlord_permits' AND column_name = 'boarding_house_id') THEN
        CREATE INDEX IF NOT EXISTS idx_permits_boarding_house ON landlord_permits(boarding_house_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'landlord_permits' AND column_name = 'vehicle_id') THEN
        CREATE INDEX IF NOT EXISTS idx_permits_vehicle ON landlord_permits(vehicle_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_permits_verification ON landlord_permits(verification_status);

-- Rooms indexes
CREATE INDEX IF NOT EXISTS idx_rooms_boarding_house ON rooms(boarding_house_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- Beds indexes
CREATE INDEX IF NOT EXISTS idx_beds_room ON beds(room_id);
CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);
CREATE INDEX IF NOT EXISTS idx_beds_type ON beds(bed_type);
CREATE INDEX IF NOT EXISTS idx_beds_parent ON beds(parent_bed_id);

-- Images indexes
CREATE INDEX IF NOT EXISTS idx_images_boarding_house ON vehicle_images(boarding_house_id);
CREATE INDEX IF NOT EXISTS idx_images_room ON vehicle_images(room_id);
CREATE INDEX IF NOT EXISTS idx_images_category ON vehicle_images(image_category);
CREATE INDEX IF NOT EXISTS idx_images_display_order ON vehicle_images(display_order);

-- Tenant profiles indexes
CREATE INDEX IF NOT EXISTS idx_tenant_profiles_user_id ON tenant_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_profiles_email ON tenant_profiles(email);

-- Rentals indexes
CREATE INDEX IF NOT EXISTS idx_Rentals_tenant ON Rentals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_Rentals_boarding_house ON Rentals(boarding_house_id);
CREATE INDEX IF NOT EXISTS idx_Rentals_room ON Rentals(room_id);
CREATE INDEX IF NOT EXISTS idx_Rentals_bed ON Rentals(bed_id);
CREATE INDEX IF NOT EXISTS idx_Rentals_status ON Rentals(status);
-- Only create dates index if columns exist
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'check_in_date') 
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'check_out_date') THEN
        CREATE INDEX IF NOT EXISTS idx_Rentals_dates ON Rentals(check_in_date, check_out_date);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_Rentals_created ON Rentals(created_at DESC);

-- Reviews indexes (conditional)
-- Only create rental_id index if column exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'rental_id') THEN
        CREATE INDEX IF NOT EXISTS idx_reviews_rental ON reviews(rental_id);
    END IF;
END $$;
DO $$ 
BEGIN
    -- tenant_id index
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_id') THEN
        CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id);
    END IF;
    -- boarding_house_id index
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'boarding_house_id') THEN
        CREATE INDEX IF NOT EXISTS idx_reviews_boarding_house ON reviews(boarding_house_id);
    END IF;
    -- vehicle_id index (for backward compatibility)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'vehicle_id') THEN
        CREATE INDEX IF NOT EXISTS idx_reviews_vehicle ON reviews(vehicle_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
-- Only create is_verified and is_visible indexes if columns exist
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'is_verified') THEN
        CREATE INDEX IF NOT EXISTS idx_reviews_verified ON reviews(is_verified);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'is_visible') THEN
        CREATE INDEX IF NOT EXISTS idx_reviews_visible ON reviews(is_visible);
    END IF;
END $$;

-- Analytics indexes
-- Analytics indexes (conditional)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rental_analytics' AND column_name = 'boarding_house_id') THEN
        CREATE INDEX IF NOT EXISTS idx_analytics_boarding_house ON rental_analytics(boarding_house_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rental_analytics' AND column_name = 'vehicle_id') THEN
        CREATE INDEX IF NOT EXISTS idx_analytics_vehicle ON rental_analytics(vehicle_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_analytics_date ON rental_analytics(date DESC);

-- ============================================================================
-- 13. TRIGGERS & FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_landlord_profiles_updated_at ON landlord_profiles;
CREATE TRIGGER update_landlord_profiles_updated_at 
    BEFORE UPDATE ON landlord_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Only create trigger if boarding_houses is a table (not a view)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        DROP TRIGGER IF EXISTS update_boarding_houses_updated_at ON boarding_houses;
        CREATE TRIGGER update_boarding_houses_updated_at 
            BEFORE UPDATE ON boarding_houses
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DROP TRIGGER IF EXISTS update_rooms_updated_at ON rooms;
CREATE TRIGGER update_rooms_updated_at 
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_beds_updated_at ON beds;
CREATE TRIGGER update_beds_updated_at 
    BEFORE UPDATE ON beds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_Rentals_updated_at ON Rentals;
CREATE TRIGGER update_Rentals_updated_at 
    BEFORE UPDATE ON Rentals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reviews_updated_at ON reviews;
CREATE TRIGGER update_reviews_updated_at 
    BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tenant_profiles_updated_at ON tenant_profiles;
CREATE TRIGGER update_tenant_profiles_updated_at 
    BEFORE UPDATE ON tenant_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update bed status when rental is approved/rejected
CREATE OR REPLACE FUNCTION update_bed_status_on_rental()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        -- Mark bed as occupied
        UPDATE beds SET status = 'occupied' WHERE id = NEW.bed_id;
        -- Update room occupancy
        UPDATE rooms SET current_occupancy = current_occupancy + 1 WHERE id = NEW.room_id;
        -- Update boarding house rental count (only if boarding_houses is a table)
        IF EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'boarding_houses' 
            AND table_type = 'BASE TABLE'
        ) THEN
            UPDATE boarding_houses SET total_Rentals = total_Rentals + 1 
            WHERE id = COALESCE(NEW.boarding_house_id, NEW.vehicle_id);
        END IF;
    ELSIF NEW.status IN ('rejected', 'cancelled') AND OLD.status = 'approved' THEN
        -- Mark bed as available
        UPDATE beds SET status = 'available' WHERE id = NEW.bed_id;
        -- Update room occupancy
        UPDATE rooms SET current_occupancy = GREATEST(current_occupancy - 1, 0) WHERE id = NEW.room_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_bed_status_trigger ON Rentals;
CREATE TRIGGER update_bed_status_trigger
    AFTER UPDATE ON Rentals
    FOR EACH ROW EXECUTE FUNCTION update_bed_status_on_rental();

-- Function to update boarding house rating when review is added/updated
CREATE OR REPLACE FUNCTION update_boarding_house_rating()
RETURNS TRIGGER AS $$
DECLARE
    bh_id UUID;
BEGIN
    -- Get the boarding_house_id (support both new and old schema)
    bh_id := COALESCE(NEW.boarding_house_id, NEW.vehicle_id, OLD.boarding_house_id, OLD.vehicle_id);
    
    -- Only update if boarding_houses is a table (not a view) and bh_id exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) AND bh_id IS NOT NULL THEN
        IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
            UPDATE boarding_houses 
            SET 
                rating = (
                    SELECT COALESCE(AVG(rating), 0) 
                    FROM reviews 
                    WHERE COALESCE(boarding_house_id, vehicle_id) = bh_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                ),
                total_reviews = (
                    SELECT COUNT(*) 
                    FROM reviews 
                    WHERE COALESCE(boarding_house_id, vehicle_id) = bh_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                )
            WHERE id = bh_id;
            RETURN NEW;
        ELSIF TG_OP = 'DELETE' THEN
            UPDATE boarding_houses 
            SET 
                rating = (
                    SELECT COALESCE(AVG(rating), 0) 
                    FROM reviews 
                    WHERE COALESCE(boarding_house_id, vehicle_id) = bh_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                ),
                total_reviews = (
                    SELECT COUNT(*) 
                    FROM reviews 
                    WHERE COALESCE(boarding_house_id, vehicle_id) = bh_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                )
            WHERE id = bh_id;
            RETURN OLD;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_boarding_house_rating_trigger ON reviews;
CREATE TRIGGER update_boarding_house_rating_trigger
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_boarding_house_rating();

-- Function to verify review eligibility (rental must be approved)
CREATE OR REPLACE FUNCTION verify_review_eligibility()
RETURNS TRIGGER AS $$
BEGIN
    -- If rental_id is provided, verify the rental is approved
    -- Allow NULL rental_id for backward compatibility with old reviews
    IF NEW.rental_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM Rentals 
            WHERE id = NEW.rental_id 
            AND status = 'approved'
        ) THEN
            RAISE EXCEPTION 'Review can only be submitted for approved Rentals';
        END IF;
        
        -- Mark review as verified since rental is approved
        NEW.is_verified = TRUE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS verify_review_eligibility_trigger ON reviews;
CREATE TRIGGER verify_review_eligibility_trigger
    BEFORE INSERT ON reviews
    FOR EACH ROW EXECUTE FUNCTION verify_review_eligibility();

-- Function to update room status based on occupancy
CREATE OR REPLACE FUNCTION update_room_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_occupancy >= NEW.max_beds THEN
        NEW.status = 'full';
    ELSIF NEW.current_occupancy < NEW.max_beds THEN
        NEW.status = 'available';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_room_status_trigger ON rooms;
CREATE TRIGGER update_room_status_trigger
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_room_status();

-- Function to automatically link double-deck bed pairs (upper and lower)
CREATE OR REPLACE FUNCTION link_double_deck_beds()
RETURNS TRIGGER AS $$
DECLARE
    partner_bed_uuid UUID;
BEGIN
    -- If this is an upper deck bed, find or create its lower partner
    IF NEW.bed_type = 'double_deck_upper' AND NEW.partner_bed_id IS NULL THEN
        -- Look for an unlinked lower deck bed in the same room
        SELECT id INTO partner_bed_uuid
        FROM beds
        WHERE room_id = NEW.room_id
        AND bed_type = 'double_deck_lower'
        AND partner_bed_id IS NULL
        AND parent_bed_id = NEW.parent_bed_id
        LIMIT 1;
        
        -- If found, link them
        IF partner_bed_uuid IS NOT NULL THEN
            UPDATE beds SET partner_bed_id = NEW.id WHERE id = partner_bed_uuid;
            NEW.partner_bed_id := partner_bed_uuid;
        END IF;
    END IF;
    
    -- If this is a lower deck bed, find or create its upper partner
    IF NEW.bed_type = 'double_deck_lower' AND NEW.partner_bed_id IS NULL THEN
        -- Look for an unlinked upper deck bed in the same room
        SELECT id INTO partner_bed_uuid
        FROM beds
        WHERE room_id = NEW.room_id
        AND bed_type = 'double_deck_upper'
        AND partner_bed_id IS NULL
        AND parent_bed_id = NEW.parent_bed_id
        LIMIT 1;
        
        -- If found, link them
        IF partner_bed_uuid IS NOT NULL THEN
            UPDATE beds SET partner_bed_id = NEW.id WHERE id = partner_bed_uuid;
            NEW.partner_bed_id := partner_bed_uuid;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS link_double_deck_beds_trigger ON beds;
CREATE TRIGGER link_double_deck_beds_trigger
    BEFORE INSERT OR UPDATE ON beds
    FOR EACH ROW 
    WHEN (NEW.bed_type IN ('double_deck_upper', 'double_deck_lower'))
    EXECUTE FUNCTION link_double_deck_beds();

-- ============================================================================
-- 15. VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View: Boarding houses with priority (most frequently booked first) - Created conditionally
DO $$ 
BEGIN
    -- Drop view if exists
    DROP VIEW IF EXISTS boarding_houses_priority;
    
    -- Check if required columns exist
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'is_visible') THEN
        EXECUTE '
        CREATE VIEW boarding_houses_priority AS
        SELECT
            bh.id,
            bh.landlord_id,
            bh.landlord_email as boarding_house_landlord_email,
            bh.name,
            bh.description,
            bh.address,
            bh.barangay,
            bh.municipality_city,
            bh.province,
            bh.lat,
            bh.lng,
            bh.price_per_bed,
            bh.amenities,
            bh.house_rules,
            bh.contact_phone,
            bh.contact_email,
            bh.status,
            bh.rating,
            bh.total_reviews,
            bh.total_Rentals,
            bh.is_featured,
            bh.admin_notes,
            bh.created_at,
            bh.updated_at,
            lp.full_name as landlord_name,
            lp.email as landlord_email,
            COUNT(DISTINCT b.id) as recent_Rentals_count,
            COUNT(DISTINCT r.id) as total_reviews_count,
            COALESCE(AVG(r.rating), 0) as calculated_rating
        FROM boarding_houses bh
        LEFT JOIN landlord_profiles lp ON bh.landlord_id = lp.id
        LEFT JOIN Rentals b ON COALESCE(b.boarding_house_id, b.vehicle_id) = bh.id 
            AND b.created_at >= NOW() - INTERVAL ''30 days''
        LEFT JOIN reviews r ON COALESCE(r.boarding_house_id, r.vehicle_id) = bh.id 
            AND (r.is_visible = TRUE OR r.is_visible IS NULL)
        WHERE bh.status = ''active''
        GROUP BY bh.id, bh.landlord_id, bh.landlord_email, bh.name, bh.description, bh.address, bh.barangay, 
                 bh.municipality_city, bh.province, bh.lat, bh.lng, bh.price_per_bed, 
                 bh.amenities, bh.house_rules, bh.contact_phone, bh.contact_email, 
                 bh.status, bh.rating, bh.total_reviews, bh.total_Rentals, 
                 bh.is_featured, bh.admin_notes, bh.created_at, bh.updated_at,
                 lp.full_name, lp.email
        ORDER BY 
            bh.total_Rentals DESC,
            recent_Rentals_count DESC,
            calculated_rating DESC';
    ELSE
        -- Create view without is_visible check if column doesn't exist
        EXECUTE '
        CREATE VIEW boarding_houses_priority AS
        SELECT
            bh.id,
            bh.landlord_id,
            bh.landlord_email as boarding_house_landlord_email,
            bh.name,
            bh.description,
            bh.address,
            bh.barangay,
            bh.municipality_city,
            bh.province,
            bh.lat,
            bh.lng,
            bh.price_per_bed,
            bh.amenities,
            bh.house_rules,
            bh.contact_phone,
            bh.contact_email,
            bh.status,
            bh.rating,
            bh.total_reviews,
            bh.total_Rentals,
            bh.is_featured,
            bh.admin_notes,
            bh.created_at,
            bh.updated_at,
            lp.full_name as landlord_name,
            lp.email as landlord_email,
            COUNT(DISTINCT b.id) as recent_Rentals_count,
            COUNT(DISTINCT r.id) as total_reviews_count,
            COALESCE(AVG(r.rating), 0) as calculated_rating
        FROM boarding_houses bh
        LEFT JOIN landlord_profiles lp ON bh.landlord_id = lp.id
        LEFT JOIN Rentals b ON COALESCE(b.boarding_house_id, b.vehicle_id) = bh.id 
            AND b.created_at >= NOW() - INTERVAL ''30 days''
        LEFT JOIN reviews r ON COALESCE(r.boarding_house_id, r.vehicle_id) = bh.id
        WHERE bh.status = ''active''
        GROUP BY bh.id, bh.landlord_id, bh.landlord_email, bh.name, bh.description, bh.address, bh.barangay, 
                 bh.municipality_city, bh.province, bh.lat, bh.lng, bh.price_per_bed, 
                 bh.amenities, bh.house_rules, bh.contact_phone, bh.contact_email, 
                 bh.status, bh.rating, bh.total_reviews, bh.total_Rentals, 
                 bh.is_featured, bh.admin_notes, bh.created_at, bh.updated_at,
                 lp.full_name, lp.email
        ORDER BY 
            bh.total_Rentals DESC,
            recent_Rentals_count DESC,
            calculated_rating DESC';
    END IF;
END $$;

-- View: Available beds with status indicators
CREATE OR REPLACE VIEW available_beds_view AS
SELECT 
    b.id,
    b.bed_number,
    b.bed_type,
    b.status,
    b.price,
    r.id as room_id,
    r.room_number,
    r.room_name,
    bh.id as boarding_house_id,
    bh.name as boarding_house_name,
    bh.address as location,
    CASE 
        WHEN b.status = 'available' THEN '🟢'
        WHEN b.status = 'occupied' THEN '🔴'
        ELSE '⚪'
    END as status_indicator
FROM beds b
JOIN rooms r ON b.room_id = r.id
JOIN boarding_houses bh ON r.boarding_house_id = bh.id
WHERE bh.status = 'active' AND r.status != 'maintenance';

-- View: Admin dashboard analytics
CREATE OR REPLACE VIEW admin_dashboard_analytics AS
SELECT 
    COUNT(DISTINCT lp.id) as total_landlords,
    COUNT(DISTINCT tp.id) as total_tenants,
    COUNT(DISTINCT bh.id) as total_boarding_houses,
    COUNT(DISTINCT b.id) as total_Rentals,
    COUNT(DISTINCT CASE WHEN b.status = 'approved' THEN b.id END) as approved_Rentals,
    COUNT(DISTINCT CASE WHEN b.status = 'pending' THEN b.id END) as pending_Rentals,
    COALESCE(SUM(CASE WHEN b.status = 'approved' THEN b.total_amount ELSE 0 END), 0) as total_revenue,
    COUNT(DISTINCT r.id) as total_reviews,
    COUNT(DISTINCT CASE WHEN lp.verification_status = 'pending' THEN lp.id END) as pending_landlord_verifications,
    COUNT(DISTINCT CASE WHEN p.verification_status = 'pending' THEN p.id END) as pending_permit_verifications
FROM landlord_profiles lp
FULL OUTER JOIN tenant_profiles tp ON 1=1
FULL OUTER JOIN boarding_houses bh ON 1=1
FULL OUTER JOIN Rentals b ON 1=1
FULL OUTER JOIN reviews r ON 1=1
FULL OUTER JOIN landlord_permits p ON 1=1;

-- View: Landlord sales report
CREATE OR REPLACE VIEW landlord_sales_report AS
SELECT 
    lp.id as landlord_id,
    lp.full_name as landlord_name,
    lp.email as landlord_email,
    bh.id as boarding_house_id,
    bh.name as boarding_house_name,
    COUNT(DISTINCT b.id) as total_Rentals,
    COUNT(DISTINCT CASE WHEN b.status = 'approved' THEN b.id END) as approved_Rentals,
    COUNT(DISTINCT r.id) as booked_rooms,
    COUNT(DISTINCT b.bed_id) as booked_bed_spaces,
    COALESCE(SUM(CASE WHEN b.status = 'approved' THEN b.total_amount ELSE 0 END), 0) as total_revenue,
    COALESCE(AVG(CASE WHEN b.status = 'approved' THEN b.total_amount END), 0) as avg_rental_amount
FROM landlord_profiles lp
JOIN boarding_houses bh ON lp.id = bh.landlord_id
LEFT JOIN Rentals b ON bh.id = b.boarding_house_id
LEFT JOIN rooms r ON b.room_id = r.id
GROUP BY lp.id, lp.full_name, lp.email, bh.id, bh.name;

-- View: Tenant rental details (for admin) - Created conditionally
DO $$ 
BEGIN
    -- Drop view if it exists (to recreate with correct columns)
    DROP VIEW IF EXISTS tenant_rental_details;
    
    -- Check if required columns exist before creating view
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Rentals' 
        AND column_name IN ('check_in_date', 'check_out_date', 'full_name', 'tenant_email')
    ) THEN
        EXECUTE '
        CREATE VIEW tenant_rental_details AS
        SELECT 
            b.id as rental_id,
            COALESCE(b.full_name, '''') as tenant_full_name,
            COALESCE(b.address, '''') as address,
            COALESCE(b.barangay, '''') as barangay,
            COALESCE(b.municipality_city, '''') as municipality_city,
            COALESCE(b.gender, '''') as gender,
            COALESCE(b.age, 0) as age,
            COALESCE(b.citizenship, '''') as citizenship,
            COALESCE(b.occupation_status, '''') as occupation_status,
            b.status as rental_status,
            b.check_in_date,
            b.check_out_date,
            COALESCE(b.total_amount, 0) as total_amount,
            bh.name as boarding_house_name,
            r.room_number,
            bed.bed_number,
            bed.bed_type,
            b.created_at as rental_date
        FROM Rentals b
        LEFT JOIN boarding_houses bh ON COALESCE(b.boarding_house_id, b.vehicle_id) = bh.id
        LEFT JOIN rooms r ON b.room_id = r.id
        LEFT JOIN beds bed ON b.bed_id = bed.id';
    END IF;
END $$;

-- ============================================================================
-- 16. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE landlord_profiles ENABLE ROW LEVEL SECURITY;
-- Only enable RLS on boarding_houses if it's a table (not a view)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        ALTER TABLE boarding_houses ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;
ALTER TABLE landlord_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE Rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_reports ENABLE ROW LEVEL SECURITY;

-- Vehicles: Enable RLS if table exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'Vehicles' 
        AND table_type = 'BASE TABLE'
    ) THEN
        ALTER TABLE Vehicles ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- Vehicles: RLS Policies (only if Vehicles table exists)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'Vehicles' 
        AND table_type = 'BASE TABLE'
    ) THEN
        -- Everyone can view available/active Vehicles (works for both authenticated and anonymous users)
        -- This policy allows viewing Vehicles with status 'available', 'active', or NULL (for backward compatibility)
        DROP POLICY IF EXISTS "Everyone can view available Vehicles" ON Vehicles;
        CREATE POLICY "Everyone can view available Vehicles" ON Vehicles
            FOR SELECT 
            USING (
                status = 'available' 
                OR status = 'active' 
                OR status IS NULL
            );
    END IF;
END $$;

-- User Profiles: Users can manage their own profile
DROP POLICY IF EXISTS "Users can manage own profile" ON user_profiles;
CREATE POLICY "Users can manage own profile" ON user_profiles
    FOR ALL USING (user_email = current_setting('app.current_user_email', true));

-- Landlord Profiles: Landlords can manage their own profile
DROP POLICY IF EXISTS "Landlords can manage own profile" ON landlord_profiles;
CREATE POLICY "Landlords can manage own profile" ON landlord_profiles
    FOR ALL USING (email = current_setting('app.current_user_email', true));

-- Boarding Houses: RLS Policies (only if boarding_houses is a table, not a view)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'boarding_houses' 
        AND table_type = 'BASE TABLE'
    ) THEN
        -- Everyone can view active boarding houses
        DROP POLICY IF EXISTS "Everyone can view active boarding houses" ON boarding_houses;
        CREATE POLICY "Everyone can view active boarding houses" ON boarding_houses
            FOR SELECT USING (status = 'active');

        -- Landlords can manage their own boarding houses
        DROP POLICY IF EXISTS "Landlords can manage own boarding houses" ON boarding_houses;
        CREATE POLICY "Landlords can manage own boarding houses" ON boarding_houses
            FOR ALL USING (landlord_email = current_setting('app.current_user_email', true));
    END IF;
END $$;

-- Rooms: Everyone can view rooms of active boarding houses
DROP POLICY IF EXISTS "Everyone can view rooms" ON rooms;
CREATE POLICY "Everyone can view rooms" ON rooms
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM boarding_houses 
            WHERE boarding_houses.id = rooms.boarding_house_id 
            AND boarding_houses.status = 'active'
        )
        OR EXISTS (
            SELECT 1 FROM Vehicles 
            WHERE Vehicles.id = rooms.vehicle_id 
            AND Vehicles.status = 'available'
        )
    );

-- Rooms: Landlords can manage rooms for their own Vehicles
DROP POLICY IF EXISTS "Landlords can manage own rooms" ON rooms;
CREATE POLICY "Landlords can manage own rooms" ON rooms
    FOR ALL USING (
        -- Check via boarding_houses and landlord_profiles using user_id
        EXISTS (
            SELECT 1 FROM boarding_houses bh
            JOIN landlord_profiles lp ON bh.landlord_id = lp.id
            WHERE bh.id = rooms.boarding_house_id
            AND lp.user_id = auth.uid()
        )
        -- Check via Vehicles and landlord_profiles using email
        OR EXISTS (
            SELECT 1 FROM Vehicles p
            JOIN landlord_profiles lp ON p.owner_email = lp.email
            WHERE p.id = rooms.vehicle_id
            AND (lp.user_id = auth.uid() OR lp.email = (SELECT email FROM auth.users WHERE id = auth.uid()))
        )
        -- Fallback: check via current_setting if available
        OR EXISTS (
            SELECT 1 FROM boarding_houses bh
            JOIN landlord_profiles lp ON bh.landlord_id = lp.id
            WHERE bh.id = rooms.boarding_house_id
            AND lp.email = current_setting('app.current_user_email', true)
        )
        OR EXISTS (
            SELECT 1 FROM Vehicles p
            JOIN landlord_profiles lp ON p.owner_email = lp.email
            WHERE p.id = rooms.vehicle_id
            AND lp.email = current_setting('app.current_user_email', true)
        )
    );

-- Beds: Everyone can view beds with availability
DROP POLICY IF EXISTS "Everyone can view beds" ON beds;
CREATE POLICY "Everyone can view beds" ON beds
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM rooms 
            JOIN boarding_houses ON rooms.boarding_house_id = boarding_houses.id
            WHERE rooms.id = beds.room_id 
            AND boarding_houses.status = 'active'
        )
        OR EXISTS (
            SELECT 1 FROM rooms 
            JOIN Vehicles ON rooms.vehicle_id = Vehicles.id
            WHERE rooms.id = beds.room_id 
            AND Vehicles.status = 'available'
        )
    );

-- Beds: Landlords can manage beds for their own Vehicles
DROP POLICY IF EXISTS "Landlords can manage own beds" ON beds;
CREATE POLICY "Landlords can manage own beds" ON beds
    FOR ALL USING (
        -- Check via boarding_houses and landlord_profiles using user_id
        EXISTS (
            SELECT 1 FROM rooms r
            JOIN boarding_houses bh ON r.boarding_house_id = bh.id
            JOIN landlord_profiles lp ON bh.landlord_id = lp.id
            WHERE r.id = beds.room_id
            AND lp.user_id = auth.uid()
        )
        -- Check via Vehicles and landlord_profiles using email
        OR EXISTS (
            SELECT 1 FROM rooms r
            JOIN Vehicles p ON r.vehicle_id = p.id
            JOIN landlord_profiles lp ON p.owner_email = lp.email
            WHERE r.id = beds.room_id
            AND (lp.user_id = auth.uid() OR lp.email = (SELECT email FROM auth.users WHERE id = auth.uid()))
        )
        -- Fallback: check via current_setting if available
        OR EXISTS (
            SELECT 1 FROM rooms r
            JOIN boarding_houses bh ON r.boarding_house_id = bh.id
            JOIN landlord_profiles lp ON bh.landlord_id = lp.id
            WHERE r.id = beds.room_id
            AND lp.email = current_setting('app.current_user_email', true)
        )
        OR EXISTS (
            SELECT 1 FROM rooms r
            JOIN Vehicles p ON r.vehicle_id = p.id
            JOIN landlord_profiles lp ON p.owner_email = lp.email
            WHERE r.id = beds.room_id
            AND lp.email = current_setting('app.current_user_email', true)
        )
    );

-- Rentals: RLS Policies (conditional - only if tenant_email column exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
        -- Tenants can view their own Rentals
        DROP POLICY IF EXISTS "Tenants can view own Rentals" ON Rentals;
        CREATE POLICY "Tenants can view own Rentals" ON Rentals
            FOR SELECT USING (tenant_email = current_setting('app.current_user_email', true));

        -- Tenants can create Rentals
        DROP POLICY IF EXISTS "Tenants can create Rentals" ON Rentals;
        CREATE POLICY "Tenants can create Rentals" ON Rentals
            FOR INSERT WITH CHECK (tenant_email = current_setting('app.current_user_email', true));
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_email') THEN
        -- Fallback to client_email for old schema
        DROP POLICY IF EXISTS "Tenants can view own Rentals" ON Rentals;
        CREATE POLICY "Tenants can view own Rentals" ON Rentals
            FOR SELECT USING (client_email = current_setting('app.current_user_email', true));

        DROP POLICY IF EXISTS "Tenants can create Rentals" ON Rentals;
        CREATE POLICY "Tenants can create Rentals" ON Rentals
            FOR INSERT WITH CHECK (client_email = current_setting('app.current_user_email', true));
    END IF;
END $$;

-- Reviews: Everyone can view verified reviews (conditional - only if columns exist)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'is_visible')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'is_verified') THEN
        -- Drop policy if exists
        DROP POLICY IF EXISTS "Everyone can view verified reviews" ON reviews;
        -- Create policy
        EXECUTE 'CREATE POLICY "Everyone can view verified reviews" ON reviews FOR SELECT USING (is_visible = TRUE AND is_verified = TRUE)';
    END IF;
END $$;

-- Reviews: Tenants can create reviews for their approved Rentals (conditional)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_email')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
        DROP POLICY IF EXISTS "Tenants can create reviews" ON reviews;
        CREATE POLICY "Tenants can create reviews" ON reviews
            FOR INSERT WITH CHECK (
                tenant_email = current_setting('app.current_user_email', true)
                AND EXISTS (
                    SELECT 1 FROM Rentals 
                    WHERE Rentals.id = reviews.rental_id 
                    AND Rentals.tenant_email = current_setting('app.current_user_email', true)
                    AND Rentals.status = 'approved'
                )
            );
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_email')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_email') THEN
        -- Fallback to client_email for old schema
        DROP POLICY IF EXISTS "Tenants can create reviews" ON reviews;
        CREATE POLICY "Tenants can create reviews" ON reviews
            FOR INSERT WITH CHECK (
                tenant_email = current_setting('app.current_user_email', true)
                AND EXISTS (
                    SELECT 1 FROM Rentals 
                    WHERE Rentals.id = reviews.rental_id 
                    AND Rentals.client_email = current_setting('app.current_user_email', true)
                    AND Rentals.status = 'approved'
                )
            );
    END IF;
END $$;

-- Admin policies (assuming admin role check function exists)
DROP POLICY IF EXISTS "Admins can manage all data" ON landlord_profiles;
CREATE POLICY "Admins can manage all data" ON landlord_profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles 
            WHERE user_roles.email = current_setting('app.current_user_email', true)
            AND user_roles.role = 'admin'
        )
    );

-- ============================================================================
-- 16. GRANT PERMISSIONS
-- ============================================================================

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon; -- For public viewing

-- ============================================================================
-- 17. SAMPLE DATA (Optional - for testing)
-- ============================================================================

-- Note: Uncomment below to insert sample data for testing

/*
-- Sample Landlord Profile
INSERT INTO landlord_profiles (user_id, email, full_name, phone, is_verified, verification_status)
VALUES 
    (gen_random_uuid(), 'landlord@example.com', 'John Landlord', '+63-912-345-6789', TRUE, 'approved')
ON CONFLICT (email) DO NOTHING;

-- Sample Tenant Profile
INSERT INTO tenant_profiles (user_id, email, full_name, phone, gender, age, citizenship, occupation_status)
VALUES 
    (gen_random_uuid(), 'tenant@example.com', 'Jane Tenant', '+63-912-345-6790', 'Female', 22, 'Filipino', 'Student')
ON CONFLICT (email) DO NOTHING;
*/

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================


