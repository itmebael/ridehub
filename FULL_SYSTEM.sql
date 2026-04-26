-- ============================================================================
-- FULL_SYSTEM.sql (Combined)
-- ============================================================================
-- Purpose:
--   Single combined SQL script for the Carrental / RideHub system.
--   Intended to run top-to-bottom in Supabase Dashboard → SQL Editor.
--
-- Contains (in order):
--   0) Extensions / baseline compatibility (pgcrypto)
--   1) app_users table (required by validate_role + verification-aware storage policies)
--   2) validate_role(expected_role) RPC
--   3) Core schema (adapted from the legacy base schema)
--   4) Vehicles.business_permit_url migration (supabase_schema_update.sql, made idempotent)
--   5) Storage buckets + policies
--
-- Notes:
--   - Required storage buckets are created automatically if they do not already exist.
--   - This script uses gen_random_uuid() → pgcrypto extension.
-- ============================================================================

-- 0) Extensions / baseline compatibility
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) app_users base table (for auth/verification/RPC usage)
--    This project uses BOTH role vocabularies in various places; allow both.
CREATE TABLE IF NOT EXISTS public.app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(20) NOT NULL CHECK (role IN ('client', 'owner', 'tenant', 'admin')),
    is_verified BOOLEAN DEFAULT FALSE NOT NULL,
    phone TEXT,
    address TEXT,
    barangay TEXT,
    city TEXT,
    id_document_url TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN public.app_users.phone IS 'Phone number of the user';
COMMENT ON COLUMN public.app_users.address IS 'Street address of the user';
COMMENT ON COLUMN public.app_users.barangay IS 'Barangay of the user';
COMMENT ON COLUMN public.app_users.city IS 'City of the user';
COMMENT ON COLUMN public.app_users.id_document_url IS 'URL to the uploaded ID document image for verification';
COMMENT ON COLUMN public.app_users.profile_image_url IS 'URL to the uploaded profile image for the user';

-- 1.5) Vehicles table (required by dashboards + Rentals + policies)
-- This project historically used `Vehicles` as the primary listings table.
-- IMPORTANT: Do NOT quote the identifier; all references in this repo use unquoted `Vehicles`,
-- which PostgreSQL folds to lowercase `vehicles`.
CREATE TABLE IF NOT EXISTS public.Vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID,
    owner_email VARCHAR(255),
    title VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    hourly_rate DECIMAL(10,2) DEFAULT 0,
    daily_rate DECIMAL(10,2) DEFAULT 0,
    weekly_rate DECIMAL(10,2) DEFAULT 0,
    monthly_rate DECIMAL(10,2) DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    images TEXT[] DEFAULT '{}'::text[],
    amenities TEXT[] DEFAULT '{}'::text[],
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION,
    boundary_size_meters INTEGER DEFAULT 200,
    boundary_north_lat DOUBLE PRECISION,
    boundary_south_lat DOUBLE PRECISION,
    boundary_east_lng DOUBLE PRECISION,
    boundary_west_lng DOUBLE PRECISION,
    status VARCHAR(20) DEFAULT 'available',
    rating DECIMAL(3,2) DEFAULT 0.0,
    total_reviews INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    business_permit_url TEXT,
    geofence_alert_sent_at TIMESTAMP WITH TIME ZONE,
    tracking_device_id TEXT,
    tracking_enabled BOOLEAN DEFAULT FALSE,
    tracking_provider TEXT DEFAULT 'Manual GPS',
    tracking_last_ping TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2) validate_role RPC (verbatim from create_validate_role_function.sql)
CREATE OR REPLACE FUNCTION validate_role(expected_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    current_user_id UUID;
    user_role TEXT;
BEGIN
    -- Get the current authenticated user ID
    current_user_id := auth.uid();
    
    -- If no user is authenticated, return false
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Get the user's role from the app_users table
    SELECT role INTO user_role
    FROM app_users
    WHERE user_id = current_user_id;
    
    -- If user not found in app_users table, return false
    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if the user's role matches the expected role
    RETURN user_role = expected_role;
END;
$$;

-- ============================================================================
-- 3) Core schema (adapted from the legacy base schema)
-- ============================================================================

-- ============================================================================
-- RideHub Complete Database Schema
-- Modern vehicle rental platform with comprehensive features
-- ============================================================================

-- ============================================================================
-- MIGRATION: Handle existing schema compatibility
-- ============================================================================

-- Migrate old Rentals structure to new structure
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Rentals') THEN
        -- Check if this is the old schema (has vehicle_id, client_name, etc.)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'vehicle_id')
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_name') THEN
            -- Map old columns to new columns
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
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('Rentals', 'rentals') AND column_name = 'payment_status') THEN
                ALTER TABLE Rentals ADD COLUMN payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'partial', 'refunded'));
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('Rentals', 'rentals') AND column_name = 'payment_method') THEN
                ALTER TABLE Rentals ADD COLUMN payment_method VARCHAR(50);
            END IF;
        END IF;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name IN ('Rentals', 'rentals')) THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('Rentals', 'rentals') AND column_name = 'payment_status') THEN
            ALTER TABLE Rentals ADD COLUMN payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'partial', 'refunded'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('Rentals', 'rentals') AND column_name = 'payment_method') THEN
            ALTER TABLE Rentals ADD COLUMN payment_method VARCHAR(50);
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
    role VARCHAR(20) NOT NULL CHECK (role IN ('client', 'owner', 'tenant', 'admin')),
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
-- 3. VEHICLE OWNER PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_owner_profiles (
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
-- 4. VEHICLE LISTING FIELDS
-- ============================================================================

ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS house_rules TEXT;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS total_Rentals INTEGER DEFAULT 0;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2) DEFAULT 0;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS daily_rate DECIMAL(10,2) DEFAULT 0;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS weekly_rate DECIMAL(10,2) DEFAULT 0;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS monthly_rate DECIMAL(10,2) DEFAULT 0;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS boundary_size_meters INTEGER DEFAULT 200;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS boundary_north_lat DOUBLE PRECISION;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS boundary_south_lat DOUBLE PRECISION;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS boundary_east_lng DOUBLE PRECISION;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS boundary_west_lng DOUBLE PRECISION;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS geofence_alert_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS tracking_device_id TEXT;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS tracking_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS tracking_provider TEXT DEFAULT 'Manual GPS';
ALTER TABLE public.Vehicles ADD COLUMN IF NOT EXISTS tracking_last_ping TIMESTAMP WITH TIME ZONE;

UPDATE public.Vehicles
SET daily_rate = COALESCE(NULLIF(daily_rate, 0), price, 0);

UPDATE public.Vehicles
SET price = COALESCE(NULLIF(price, 0), daily_rate, 0);

UPDATE public.Vehicles
SET hourly_rate = COALESCE(NULLIF(hourly_rate, 0), GREATEST(1, ROUND(COALESCE(NULLIF(daily_rate, 0), price, 0) / 24.0)))
WHERE COALESCE(NULLIF(daily_rate, 0), price, 0) > 0;

UPDATE public.Vehicles
SET weekly_rate = COALESCE(NULLIF(weekly_rate, 0), COALESCE(NULLIF(daily_rate, 0), price, 0) * 7)
WHERE COALESCE(NULLIF(daily_rate, 0), price, 0) > 0;

UPDATE public.Vehicles
SET monthly_rate = COALESCE(NULLIF(monthly_rate, 0), COALESCE(NULLIF(daily_rate, 0), price, 0) * 30)
WHERE COALESCE(NULLIF(daily_rate, 0), price, 0) > 0;

UPDATE public.Vehicles
SET boundary_size_meters = COALESCE(boundary_size_meters, 200);

UPDATE public.Vehicles
SET current_lat = COALESCE(current_lat, lat),
    current_lng = COALESCE(current_lng, lng)
WHERE lat IS NOT NULL
  AND lng IS NOT NULL;

UPDATE public.Vehicles
SET boundary_north_lat = COALESCE(boundary_north_lat, lat + ((COALESCE(boundary_size_meters, 200) / 2.0) / 111320.0)),
    boundary_south_lat = COALESCE(boundary_south_lat, lat - ((COALESCE(boundary_size_meters, 200) / 2.0) / 111320.0)),
    boundary_east_lng = COALESCE(boundary_east_lng, lng + ((COALESCE(boundary_size_meters, 200) / 2.0) / GREATEST(111320.0 * ABS(COS(RADIANS(lat))), 0.00001))),
    boundary_west_lng = COALESCE(boundary_west_lng, lng - ((COALESCE(boundary_size_meters, 200) / 2.0) / GREATEST(111320.0 * ABS(COS(RADIANS(lat))), 0.00001)))
WHERE lat IS NOT NULL
  AND lng IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_email VARCHAR(255) NOT NULL,
    rental_id UUID,
    vehicle_id UUID,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'general',
    priority VARCHAR(20) DEFAULT 'normal',
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS rental_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS vehicle_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'general';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'notifications'
          AND column_name = 'user_email'
    ) THEN
        UPDATE notifications
        SET recipient_email = COALESCE(recipient_email, user_email)
        WHERE user_email IS NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'notifications'
          AND column_name = 'notification_type'
    ) THEN
        UPDATE notifications
        SET type = COALESCE(notification_type, type)
        WHERE notification_type IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_email ON notifications(recipient_email);
CREATE INDEX IF NOT EXISTS idx_notifications_vehicle_id ON notifications(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Owner ↔ renter chat (OwnerDashboard / ClientDashboard)
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    owner_email VARCHAR(255) NOT NULL,
    client_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_vehicle ON public.conversations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_conversations_owner_email ON public.conversations(LOWER(TRIM(owner_email)));
CREATE INDEX IF NOT EXISTS idx_conversations_client_email ON public.conversations(LOWER(TRIM(client_email)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_vehicle_owner_client_unique
    ON public.conversations (vehicle_id, LOWER(TRIM(owner_email)), LOWER(TRIM(client_email)));

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_email VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversations;
CREATE POLICY "Participants can view conversations" ON public.conversations
    FOR SELECT TO authenticated
    USING (
        LOWER(TRIM(owner_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
        OR LOWER(TRIM(client_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
    );

DROP POLICY IF EXISTS "Participants can create conversations" ON public.conversations;
CREATE POLICY "Participants can create conversations" ON public.conversations
    FOR INSERT TO authenticated
    WITH CHECK (
        LOWER(TRIM(owner_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
        OR LOWER(TRIM(client_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
    );

DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
CREATE POLICY "Participants can read messages" ON public.messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
            AND (
                LOWER(TRIM(c.owner_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
                OR LOWER(TRIM(c.client_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
            )
        )
    );

DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages" ON public.messages
    FOR INSERT TO authenticated
    WITH CHECK (
        LOWER(TRIM(sender_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
        AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
            AND (
                LOWER(TRIM(c.owner_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
                OR LOWER(TRIM(c.client_email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
            )
        )
    );

GRANT SELECT, INSERT ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;

-- Realtime: new rows in messages (ignore if already added)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM IS NOT NULL AND (SQLERRM ILIKE '%already%' OR SQLERRM ILIKE '%member%') THEN
            NULL;
        ELSE
            RAISE;
        END IF;
END $$;

CREATE OR REPLACE FUNCTION public.send_notification(
    recipient_email_param TEXT,
    title_param TEXT,
    body_param TEXT,
    notification_type_param TEXT DEFAULT 'general',
    priority_param TEXT DEFAULT 'normal',
    rental_id_param UUID DEFAULT NULL,
    vehicle_id_param UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO notifications (
        recipient_email,
        rental_id,
        vehicle_id,
        title,
        body,
        type,
        priority,
        is_read
    ) VALUES (
        recipient_email_param,
        rental_id_param,
        vehicle_id_param,
        title_param,
        body_param,
        COALESCE(notification_type_param, 'general'),
        COALESCE(priority_param, 'normal'),
        FALSE
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vehicle_tracking_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    effective_daily_rate NUMERIC;
    effective_size NUMERIC;
    half_side NUMERIC;
    lat_delta DOUBLE PRECISION;
    lng_delta DOUBLE PRECISION;
BEGIN
    effective_daily_rate := COALESCE(NULLIF(NEW.daily_rate, 0), NULLIF(NEW.price, 0), 0);
    NEW.daily_rate := effective_daily_rate;
    NEW.price := effective_daily_rate;

    IF effective_daily_rate > 0 THEN
        NEW.hourly_rate := COALESCE(NULLIF(NEW.hourly_rate, 0), GREATEST(1, ROUND(effective_daily_rate / 24.0)));
        NEW.weekly_rate := COALESCE(NULLIF(NEW.weekly_rate, 0), effective_daily_rate * 7);
        NEW.monthly_rate := COALESCE(NULLIF(NEW.monthly_rate, 0), effective_daily_rate * 30);
    END IF;

    effective_size := GREATEST(COALESCE(NEW.boundary_size_meters, 200), 50);
    NEW.boundary_size_meters := effective_size::INTEGER;

    IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
        NEW.current_lat := COALESCE(NEW.current_lat, NEW.lat);
        NEW.current_lng := COALESCE(NEW.current_lng, NEW.lng);

        half_side := effective_size / 2.0;
        lat_delta := half_side / 111320.0;
        lng_delta := half_side / GREATEST(111320.0 * ABS(COS(RADIANS(NEW.lat))), 0.00001);

        NEW.boundary_north_lat := COALESCE(NEW.boundary_north_lat, NEW.lat + lat_delta);
        NEW.boundary_south_lat := COALESCE(NEW.boundary_south_lat, NEW.lat - lat_delta);
        NEW.boundary_east_lng := COALESCE(NEW.boundary_east_lng, NEW.lng + lng_delta);
        NEW.boundary_west_lng := COALESCE(NEW.boundary_west_lng, NEW.lng - lng_delta);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_vehicle_tracking_defaults_trigger ON public.Vehicles;
CREATE TRIGGER sync_vehicle_tracking_defaults_trigger
    BEFORE INSERT OR UPDATE ON public.Vehicles
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_vehicle_tracking_defaults();

CREATE OR REPLACE FUNCTION public.notify_owner_when_vehicle_leaves_square()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    is_outside BOOLEAN := FALSE;
    was_outside BOOLEAN := FALSE;
    north_limit DOUBLE PRECISION;
    south_limit DOUBLE PRECISION;
    east_limit DOUBLE PRECISION;
    west_limit DOUBLE PRECISION;
    renter_row RECORD;
BEGIN
    IF NEW.owner_email IS NULL
       OR NEW.current_lat IS NULL
       OR NEW.current_lng IS NULL
       OR NEW.boundary_north_lat IS NULL
       OR NEW.boundary_south_lat IS NULL
       OR NEW.boundary_east_lng IS NULL
       OR NEW.boundary_west_lng IS NULL THEN
        RETURN NEW;
    END IF;

    north_limit := GREATEST(NEW.boundary_north_lat, NEW.boundary_south_lat);
    south_limit := LEAST(NEW.boundary_north_lat, NEW.boundary_south_lat);
    east_limit := GREATEST(NEW.boundary_east_lng, NEW.boundary_west_lng);
    west_limit := LEAST(NEW.boundary_east_lng, NEW.boundary_west_lng);

    is_outside := NEW.current_lat > north_limit
        OR NEW.current_lat < south_limit
        OR NEW.current_lng > east_limit
        OR NEW.current_lng < west_limit;

    IF OLD.current_lat IS NOT NULL
       AND OLD.current_lng IS NOT NULL
       AND OLD.boundary_north_lat IS NOT NULL
       AND OLD.boundary_south_lat IS NOT NULL
       AND OLD.boundary_east_lng IS NOT NULL
       AND OLD.boundary_west_lng IS NOT NULL THEN
        was_outside := OLD.current_lat > GREATEST(OLD.boundary_north_lat, OLD.boundary_south_lat)
            OR OLD.current_lat < LEAST(OLD.boundary_north_lat, OLD.boundary_south_lat)
            OR OLD.current_lng > GREATEST(OLD.boundary_east_lng, OLD.boundary_west_lng)
            OR OLD.current_lng < LEAST(OLD.boundary_east_lng, OLD.boundary_west_lng);
    END IF;

    IF is_outside AND NOT was_outside THEN
        PERFORM public.send_notification(
            NEW.owner_email,
            'Vehicle boundary alert',
            FORMAT(
                'The vehicle "%s" moved outside its %sm x %sm boundary square. Current position: %s, %s.',
                COALESCE(NEW.title, 'Vehicle'),
                COALESCE(NEW.boundary_size_meters, 0),
                COALESCE(NEW.boundary_size_meters, 0),
                ROUND(NEW.current_lat::NUMERIC, 6),
                ROUND(NEW.current_lng::NUMERIC, 6)
            ),
            'vehicle_boundary_alert',
            'high',
            NULL,
            NEW.id
        );

        -- Notify active renters (approved booking, current date within rental window when dates exist)
        FOR renter_row IN
            SELECT DISTINCT TRIM(tenant_email) AS tenant_email
            FROM public.rentals
            WHERE vehicle_id = NEW.id
              AND status = 'approved'
              AND tenant_email IS NOT NULL
              AND TRIM(tenant_email) <> ''
              AND (
                  check_in_date IS NULL
                  OR check_out_date IS NULL
                  OR (
                      CURRENT_DATE >= check_in_date
                      AND CURRENT_DATE <= check_out_date
                  )
              )
        LOOP
            IF LOWER(renter_row.tenant_email) IS DISTINCT FROM LOWER(TRIM(COALESCE(NEW.owner_email, ''))) THEN
                PERFORM public.send_notification(
                    renter_row.tenant_email,
                    'Vehicle left allowed area',
                    FORMAT(
                        'The vehicle "%s" you are renting moved outside its allowed boundary. Last position: %s, %s. Contact the owner if you need help.',
                        COALESCE(NEW.title, 'Vehicle'),
                        ROUND(NEW.current_lat::NUMERIC, 6),
                        ROUND(NEW.current_lng::NUMERIC, 6)
                    ),
                    'vehicle_boundary_alert',
                    'high',
                    NULL,
                    NEW.id
                );
            END IF;
        END LOOP;

        NEW.geofence_alert_sent_at := NOW();
    ELSIF NOT is_outside THEN
        NEW.geofence_alert_sent_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_owner_when_vehicle_leaves_square_trigger ON public.Vehicles;
CREATE TRIGGER notify_owner_when_vehicle_leaves_square_trigger
    BEFORE UPDATE OF current_lat, current_lng, boundary_north_lat, boundary_south_lat, boundary_east_lng, boundary_west_lng
    ON public.Vehicles
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_owner_when_vehicle_leaves_square();

-- ============================================================================
-- 5. OWNER PERMITS
-- ============================================================================

CREATE TABLE IF NOT EXISTS owner_permits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES vehicle_owner_profiles(id) ON DELETE CASCADE,
    vehicle_id UUID,
    permit_type VARCHAR(50) NOT NULL CHECK (permit_type IN ('business_permit', 'vehicle_permit', 'owner_car_permit')),
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
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'vehicle_id') THEN
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
-- 8. vehicle IMAGES (Categorized: CR and Available Rooms)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID, -- Fallback for old schema
    room_id UUID, -- FK constraint added separately
    image_url TEXT NOT NULL,
    image_category VARCHAR(50) NOT NULL CHECK (image_category IN ('comfort_room', 'available_room', 'common_area', 'exterior', 'other')),
    display_order INTEGER DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 9. CLIENT PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_profiles (
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
        -- Ensure vehicle_id exists (for old schema compatibility)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'vehicle_id') THEN
            ALTER TABLE Rentals ADD COLUMN vehicle_id UUID;
        END IF;
        -- Add room_id if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'room_id') THEN
            ALTER TABLE Rentals ADD COLUMN room_id UUID;
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
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('Rentals', 'rentals') AND column_name = 'payment_status') THEN
            ALTER TABLE Rentals ADD COLUMN payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'partial', 'refunded'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('Rentals', 'rentals') AND column_name = 'payment_method') THEN
            ALTER TABLE Rentals ADD COLUMN payment_method VARCHAR(50);
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS Rentals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    tenant_email VARCHAR(255), -- NOT NULL constraint added separately if column exists
    vehicle_id UUID, -- Fallback for old schema
    room_id UUID, -- Will add FK constraint separately if table exists
    
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
    payment_method VARCHAR(50),
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
    -- Add tenant_id FK using the client profile table.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_profiles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'Rentals_tenant_id_fkey' 
                AND table_name = 'Rentals'
            ) THEN
                ALTER TABLE Rentals 
                ADD CONSTRAINT Rentals_tenant_id_fkey 
                FOREIGN KEY (tenant_id) REFERENCES client_profiles(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;

    -- Add vehicle_id FK if Vehicles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'vehicle_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'Rentals_vehicle_id_fkey'
                AND table_name = 'Rentals'
            ) THEN
                ALTER TABLE Rentals
                ADD CONSTRAINT Rentals_vehicle_id_fkey
                FOREIGN KEY (vehicle_id) REFERENCES Vehicles(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
    
    -- Add FK constraints for rooms if Vehicles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'vehicle_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'rooms_vehicle_id_fkey'
                AND table_name = 'rooms'
            ) THEN
                ALTER TABLE rooms
                ADD CONSTRAINT rooms_vehicle_id_fkey
                FOREIGN KEY (vehicle_id) REFERENCES Vehicles(id) ON DELETE CASCADE;
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

    -- Add FK constraints for vehicle_images if Vehicles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'vehicle_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'vehicle_images_vehicle_id_fkey'
                AND table_name = 'vehicle_images'
            ) THEN
                ALTER TABLE vehicle_images
                ADD CONSTRAINT vehicle_images_vehicle_id_fkey
                FOREIGN KEY (vehicle_id) REFERENCES Vehicles(id) ON DELETE CASCADE;
            END IF;
        END IF;
    END IF;
    
    -- Add FK constraint for rental_analytics if Vehicles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rental_analytics' AND column_name = 'vehicle_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'rental_analytics_vehicle_id_fkey'
                AND table_name = 'rental_analytics'
            ) THEN
                ALTER TABLE rental_analytics
                ADD CONSTRAINT rental_analytics_vehicle_id_fkey
                FOREIGN KEY (vehicle_id) REFERENCES Vehicles(id) ON DELETE CASCADE;
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
    
    -- Add FK constraint for owner_permits if Vehicles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'owner_permits' AND column_name = 'vehicle_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'owner_permits_vehicle_id_fkey' 
                AND table_name = 'owner_permits'
            ) THEN
                ALTER TABLE owner_permits 
                ADD CONSTRAINT owner_permits_vehicle_id_fkey 
                FOREIGN KEY (vehicle_id) REFERENCES Vehicles(id) ON DELETE CASCADE;
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
    
    -- Add tenant_id FK using the client profile table.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_profiles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'reviews_tenant_id_fkey' 
                AND table_name = 'reviews'
            ) THEN
                ALTER TABLE reviews 
                ADD CONSTRAINT reviews_tenant_id_fkey 
                FOREIGN KEY (tenant_id) REFERENCES client_profiles(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;

    -- Add vehicle_id FK if Vehicles exists AND column exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Vehicles') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'vehicle_id') THEN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'reviews_vehicle_id_fkey'
                AND table_name = 'reviews'
            ) THEN
                ALTER TABLE reviews
                ADD CONSTRAINT reviews_vehicle_id_fkey
                FOREIGN KEY (vehicle_id) REFERENCES Vehicles(id) ON DELETE CASCADE;
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
    vehicle_id UUID, -- Fallback for old schema
    date DATE NOT NULL,
    total_Rentals INTEGER DEFAULT 0,
    approved_Rentals INTEGER DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0.0,
    occupancy_rate DECIMAL(5,2) DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id, date)
);

-- Admin Reports (for report generation module)
CREATE TABLE IF NOT EXISTS admin_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('Rentals', 'owners', 'clients', 'revenue', 'custom')),
    filters JSONB, -- Store filter criteria (vehicle_id, date_range, etc.)
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

-- Owner profiles indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_owner_profiles_user_id ON vehicle_owner_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_owner_profiles_email ON vehicle_owner_profiles(email);
CREATE INDEX IF NOT EXISTS idx_vehicle_owner_profiles_verification ON vehicle_owner_profiles(verification_status);

-- Vehicle indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON Vehicles(owner_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON Vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_rating ON Vehicles(rating DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_Rentals ON Vehicles(total_Rentals DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_location ON Vehicles(lat, lng);
CREATE INDEX IF NOT EXISTS idx_vehicles_featured ON Vehicles(is_featured);
CREATE INDEX IF NOT EXISTS idx_vehicles_tracking_device ON Vehicles(tracking_device_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tracking_enabled ON Vehicles(tracking_enabled);

-- Permits indexes
CREATE INDEX IF NOT EXISTS idx_owner_permits_owner ON owner_permits(owner_id);
-- Only create vehicle_id index if column exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'owner_permits' AND column_name = 'vehicle_id') THEN
        CREATE INDEX IF NOT EXISTS idx_owner_permits_vehicle ON owner_permits(vehicle_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_owner_permits_verification ON owner_permits(verification_status);

-- Rooms indexes
CREATE INDEX IF NOT EXISTS idx_rooms_vehicle ON rooms(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- Images indexes
CREATE INDEX IF NOT EXISTS idx_images_vehicle ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_images_room ON vehicle_images(room_id);
CREATE INDEX IF NOT EXISTS idx_images_category ON vehicle_images(image_category);
CREATE INDEX IF NOT EXISTS idx_images_display_order ON vehicle_images(display_order);

-- Client profiles indexes
CREATE INDEX IF NOT EXISTS idx_client_profiles_user_id ON client_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_client_profiles_email ON client_profiles(email);

-- Rentals indexes
CREATE INDEX IF NOT EXISTS idx_Rentals_tenant ON Rentals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_Rentals_vehicle ON Rentals(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_Rentals_room ON Rentals(room_id);
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

-- Analytics indexes (conditional)
DO $$ 
BEGIN
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

-- Prevent owners from creating vehicle listings until they submit the required onboarding data.
CREATE OR REPLACE FUNCTION enforce_owner_requirements_before_vehicle_insert()
RETURNS TRIGGER AS $$
DECLARE
    resolved_email TEXT;
    owner_profile_id UUID;
    profile_full_name TEXT;
    profile_phone TEXT;
    profile_address TEXT;
    app_role TEXT;
    app_full_name TEXT;
    app_phone TEXT;
    app_address TEXT;
    app_barangay TEXT;
    app_city TEXT;
    app_id_document_url TEXT;
    has_permit BOOLEAN := FALSE;
    missing_items TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT LOWER(email)
    INTO resolved_email
    FROM app_users
    WHERE user_id = auth.uid()
    LIMIT 1;

    resolved_email := LOWER(COALESCE(NULLIF(TRIM(NEW.owner_email), ''), resolved_email, ''));

    IF resolved_email = '' THEN
        RAISE EXCEPTION 'Owner email is required before creating a vehicle listing.';
    END IF;

    SELECT id, full_name, phone, address
    INTO owner_profile_id, profile_full_name, profile_phone, profile_address
    FROM vehicle_owner_profiles
    WHERE LOWER(email) = resolved_email
       OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
    ORDER BY CASE WHEN auth.uid() IS NOT NULL AND user_id = auth.uid() THEN 0 ELSE 1 END
    LIMIT 1;

    SELECT role, full_name, phone, address, barangay, city, id_document_url
    INTO app_role, app_full_name, app_phone, app_address, app_barangay, app_city, app_id_document_url
    FROM app_users
    WHERE LOWER(email) = resolved_email
       OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
    ORDER BY CASE WHEN auth.uid() IS NOT NULL AND user_id = auth.uid() THEN 0 ELSE 1 END
    LIMIT 1;

    IF COALESCE(app_role, '') <> 'owner' THEN
        missing_items := array_append(missing_items, 'owner account setup');
    END IF;

    IF COALESCE(NULLIF(TRIM(profile_full_name), ''), NULLIF(TRIM(app_full_name), '')) IS NULL THEN
        missing_items := array_append(missing_items, 'full name');
    END IF;

    IF COALESCE(NULLIF(TRIM(profile_phone), ''), NULLIF(TRIM(app_phone), '')) IS NULL THEN
        missing_items := array_append(missing_items, 'phone number');
    END IF;

    IF COALESCE(NULLIF(TRIM(profile_address), ''), NULLIF(TRIM(app_address), '')) IS NULL THEN
        missing_items := array_append(missing_items, 'street address');
    END IF;

    IF NULLIF(TRIM(COALESCE(app_barangay, '')), '') IS NULL THEN
        missing_items := array_append(missing_items, 'barangay');
    END IF;

    IF NULLIF(TRIM(COALESCE(app_city, '')), '') IS NULL THEN
        missing_items := array_append(missing_items, 'city');
    END IF;

    IF NULLIF(TRIM(COALESCE(app_id_document_url, '')), '') IS NULL THEN
        missing_items := array_append(missing_items, 'government ID document');
    END IF;

    IF owner_profile_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM owner_permits
            WHERE owner_id = owner_profile_id
              AND verification_status IN ('pending', 'approved')
        )
        INTO has_permit;
    END IF;

    IF NOT has_permit THEN
        missing_items := array_append(missing_items, 'at least one business or owner car permit');
    END IF;

    IF COALESCE(array_length(missing_items, 1), 0) > 0 THEN
        RAISE EXCEPTION 'Owner requirements incomplete: %', array_to_string(missing_items, ', ');
    END IF;

    NEW.owner_email := resolved_email;

    IF NEW.owner_id IS NULL AND owner_profile_id IS NOT NULL THEN
        NEW.owner_id := owner_profile_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_owner_requirements_before_vehicle_insert_trigger ON Vehicles;
CREATE TRIGGER enforce_owner_requirements_before_vehicle_insert_trigger
    BEFORE INSERT ON Vehicles
    FOR EACH ROW EXECUTE FUNCTION enforce_owner_requirements_before_vehicle_insert();

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_vehicle_owner_profiles_updated_at ON vehicle_owner_profiles;
CREATE TRIGGER update_vehicle_owner_profiles_updated_at 
    BEFORE UPDATE ON vehicle_owner_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_Vehicles_updated_at ON Vehicles;
CREATE TRIGGER update_Vehicles_updated_at 
    BEFORE UPDATE ON Vehicles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rooms_updated_at ON rooms;
CREATE TRIGGER update_rooms_updated_at 
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_Rentals_updated_at ON Rentals;
CREATE TRIGGER update_Rentals_updated_at 
    BEFORE UPDATE ON Rentals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reviews_updated_at ON reviews;
CREATE TRIGGER update_reviews_updated_at 
    BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_client_profiles_updated_at ON client_profiles;
CREATE TRIGGER update_client_profiles_updated_at 
    BEFORE UPDATE ON client_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update room occupancy when a rental is approved/rejected
CREATE OR REPLACE FUNCTION update_room_occupancy_on_rental()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        -- Update room occupancy
        UPDATE rooms SET current_occupancy = current_occupancy + 1 WHERE id = NEW.room_id;
        -- Update vehicle rental count on the canonical Vehicles table.
        IF EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'Vehicles' 
            AND table_type = 'BASE TABLE'
        ) THEN
            UPDATE Vehicles SET total_Rentals = total_Rentals + 1 
            WHERE id = NEW.vehicle_id;
        END IF;
    ELSIF NEW.status IN ('rejected', 'cancelled') AND OLD.status = 'approved' THEN
        -- Update room occupancy
        UPDATE rooms SET current_occupancy = GREATEST(current_occupancy - 1, 0) WHERE id = NEW.room_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_bed_status_trigger ON Rentals;
DROP TRIGGER IF EXISTS update_room_occupancy_trigger ON Rentals;
CREATE TRIGGER update_room_occupancy_trigger
    AFTER UPDATE ON Rentals
    FOR EACH ROW EXECUTE FUNCTION update_room_occupancy_on_rental();

-- Function to update vehicle rating when review is added/updated
CREATE OR REPLACE FUNCTION update_vehicle_rating_rollup()
RETURNS TRIGGER AS $$
DECLARE
    target_vehicle_id UUID;
BEGIN
    target_vehicle_id := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
    
    -- Update the canonical Vehicles table when the target record exists.
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'Vehicles' 
        AND table_type = 'BASE TABLE'
    ) AND target_vehicle_id IS NOT NULL THEN
        IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
            UPDATE Vehicles 
            SET 
                rating = (
                    SELECT COALESCE(AVG(rating), 0) 
                    FROM reviews 
                    WHERE vehicle_id = target_vehicle_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                ),
                total_reviews = (
                    SELECT COUNT(*) 
                    FROM reviews 
                    WHERE vehicle_id = target_vehicle_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                )
            WHERE id = target_vehicle_id;
            RETURN NEW;
        ELSIF TG_OP = 'DELETE' THEN
            UPDATE Vehicles 
            SET 
                rating = (
                    SELECT COALESCE(AVG(rating), 0) 
                    FROM reviews 
                    WHERE vehicle_id = target_vehicle_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                ),
                total_reviews = (
                    SELECT COUNT(*) 
                    FROM reviews 
                    WHERE vehicle_id = target_vehicle_id 
                    AND (is_verified = TRUE OR is_verified IS NULL)
                    AND (is_visible = TRUE OR is_visible IS NULL)
                )
            WHERE id = target_vehicle_id;
            RETURN OLD;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vehicle_rating_rollup_trigger ON reviews;
CREATE TRIGGER update_vehicle_rating_rollup_trigger
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_vehicle_rating_rollup();

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

-- ============================================================================
-- 15. VIEWS FOR COMMON QUERIES
-- ============================================================================

DROP VIEW IF EXISTS boarding_houses_priority;

-- Legacy bed view removed from the active schema
DROP VIEW IF EXISTS available_beds_view;

-- View: Admin dashboard analytics
DROP VIEW IF EXISTS admin_dashboard_analytics;
CREATE VIEW admin_dashboard_analytics AS
SELECT 
    COUNT(DISTINCT o.id) as total_owners,
    COUNT(DISTINCT c.id) as total_clients,
    COUNT(DISTINCT v.id) as total_vehicles,
    COUNT(DISTINCT b.id) as total_Rentals,
    COUNT(DISTINCT CASE WHEN b.status = 'approved' THEN b.id END) as approved_Rentals,
    COUNT(DISTINCT CASE WHEN b.status = 'pending' THEN b.id END) as pending_Rentals,
    COALESCE(SUM(CASE WHEN b.status = 'approved' THEN b.total_amount ELSE 0 END), 0) as total_revenue,
    COUNT(DISTINCT r.id) as total_reviews,
    COUNT(DISTINCT CASE WHEN o.verification_status = 'pending' THEN o.id END) as pending_owner_verifications,
    COUNT(DISTINCT CASE WHEN p.verification_status = 'pending' THEN p.id END) as pending_permit_verifications
FROM vehicle_owner_profiles o
FULL OUTER JOIN client_profiles c ON 1=1
FULL OUTER JOIN Vehicles v ON 1=1
FULL OUTER JOIN Rentals b ON 1=1
FULL OUTER JOIN reviews r ON 1=1
FULL OUTER JOIN owner_permits p ON 1=1;

-- View: Owner sales report
DROP VIEW IF EXISTS owner_sales_report;
CREATE VIEW owner_sales_report AS
SELECT 
    o.id as owner_id,
    o.full_name as owner_name,
    o.email as owner_email,
    v.id as vehicle_id,
    v.title as vehicle_name,
    COUNT(DISTINCT b.id) as total_Rentals,
    COUNT(DISTINCT CASE WHEN b.status = 'approved' THEN b.id END) as approved_Rentals,
    COUNT(DISTINCT r.id) as booked_rooms,
    COALESCE(SUM(CASE WHEN b.status = 'approved' THEN b.total_amount ELSE 0 END), 0) as total_revenue,
    COALESCE(AVG(CASE WHEN b.status = 'approved' THEN b.total_amount END), 0) as avg_rental_amount
FROM vehicle_owner_profiles o
JOIN Vehicles v ON o.id = v.owner_id
LEFT JOIN Rentals b ON v.id = b.vehicle_id
LEFT JOIN rooms r ON b.room_id = r.id
GROUP BY o.id, o.full_name, o.email, v.id, v.title;

-- View: Client rental details (for admin) - Created conditionally
DO $$ 
BEGIN
    -- Drop view if it exists (to recreate with correct columns)
    DROP VIEW IF EXISTS tenant_rental_details;
    DROP VIEW IF EXISTS client_rental_details;
    
    -- Check if required columns exist before creating view
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Rentals' 
        AND column_name IN ('check_in_date', 'check_out_date', 'full_name', 'tenant_email')
    ) THEN
        EXECUTE '
        CREATE VIEW client_rental_details AS
        SELECT 
            b.id as rental_id,
            COALESCE(b.full_name, '''') as client_full_name,
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
            v.title as vehicle_name,
            r.room_number,
            b.created_at as rental_date
        FROM Rentals b
        LEFT JOIN Vehicles v ON b.vehicle_id = v.id
        LEFT JOIN rooms r ON b.room_id = r.id';
    END IF;
END $$;

-- ============================================================================
-- 16. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_owner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
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
    FOR ALL TO authenticated
    USING (LOWER(user_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
    WITH CHECK (LOWER(user_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')));

-- Owner Profiles: Owners can manage their own profile
DROP POLICY IF EXISTS "Owners can manage own profile" ON vehicle_owner_profiles;
CREATE POLICY "Owners can manage own profile" ON vehicle_owner_profiles
    FOR ALL TO authenticated
    USING (
        user_id = auth.uid()
        OR LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    )
    WITH CHECK (
        user_id = auth.uid()
        OR LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    );

DROP POLICY IF EXISTS "Owners can manage own Vehicles" ON Vehicles;
CREATE POLICY "Owners can manage own Vehicles" ON Vehicles
    FOR ALL TO authenticated
    USING (LOWER(owner_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
    WITH CHECK (LOWER(owner_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "Owners can manage own permits" ON owner_permits;
CREATE POLICY "Owners can manage own permits" ON owner_permits
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM vehicle_owner_profiles op
            WHERE op.id = owner_permits.owner_id
              AND (
                op.user_id = auth.uid()
                OR LOWER(op.email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM vehicle_owner_profiles op
            WHERE op.id = owner_permits.owner_id
              AND (
                op.user_id = auth.uid()
                OR LOWER(op.email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
              )
        )
    );

-- Rooms: Everyone can view rooms of active vehicles
DROP POLICY IF EXISTS "Everyone can view rooms" ON rooms;
CREATE POLICY "Everyone can view rooms" ON rooms
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM Vehicles 
            WHERE Vehicles.id = rooms.vehicle_id 
            AND (Vehicles.status = 'available' OR Vehicles.status = 'active' OR Vehicles.status IS NULL)
        )
    );

-- Rooms: Owners can manage rooms for their own Vehicles
-- Do not reference auth.users in RLS: the authenticated role cannot SELECT auth.users (42501).
DROP POLICY IF EXISTS "Owners can manage own rooms" ON rooms;
CREATE POLICY "Owners can manage own rooms" ON rooms
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM Vehicles p
            JOIN vehicle_owner_profiles op ON p.owner_email = op.email
            WHERE p.id = rooms.vehicle_id
            AND (
                op.user_id = auth.uid()
                OR LOWER(TRIM(op.email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM Vehicles p
            JOIN vehicle_owner_profiles op ON p.owner_email = op.email
            WHERE p.id = rooms.vehicle_id
            AND (
                op.user_id = auth.uid()
                OR LOWER(TRIM(op.email)) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
            )
        )
    );

-- Rentals: RLS Policies (conditional - legacy tenant_email field retained for compatibility)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
        -- Clients can view their own Rentals
        DROP POLICY IF EXISTS "Clients can view own Rentals" ON Rentals;
        CREATE POLICY "Clients can view own Rentals" ON Rentals
            FOR SELECT TO authenticated
            USING (LOWER(tenant_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')));

        -- Clients can create Rentals
        DROP POLICY IF EXISTS "Clients can create Rentals" ON Rentals;
        CREATE POLICY "Clients can create Rentals" ON Rentals
            FOR INSERT TO authenticated
            WITH CHECK (LOWER(tenant_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')));
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_email') THEN
        -- Fallback to client_email for old schema
        DROP POLICY IF EXISTS "Clients can view own Rentals" ON Rentals;
        CREATE POLICY "Clients can view own Rentals" ON Rentals
            FOR SELECT TO authenticated
            USING (LOWER(client_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')));

        DROP POLICY IF EXISTS "Clients can create Rentals" ON Rentals;
        CREATE POLICY "Clients can create Rentals" ON Rentals
            FOR INSERT TO authenticated
            WITH CHECK (LOWER(client_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')));
    END IF;
END $$;

-- Rentals: vehicle owners can read and update requests for their own listings (approve / reject / complete / payment)
DO $$
BEGIN
    IF to_regclass('public.rentals') IS NOT NULL AND to_regclass('public.vehicles') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Owners can view rentals for own vehicles" ON public.rentals;
        CREATE POLICY "Owners can view rentals for own vehicles" ON public.rentals
            FOR SELECT TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.vehicles v
                    WHERE v.id = rentals.vehicle_id
                    AND LOWER(TRIM(COALESCE(v.owner_email, ''))) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
                )
            );

        DROP POLICY IF EXISTS "Owners can update rentals for own vehicles" ON public.rentals;
        CREATE POLICY "Owners can update rentals for own vehicles" ON public.rentals
            FOR UPDATE TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.vehicles v
                    WHERE v.id = rentals.vehicle_id
                    AND LOWER(TRIM(COALESCE(v.owner_email, ''))) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.vehicles v
                    WHERE v.id = rentals.vehicle_id
                    AND LOWER(TRIM(COALESCE(v.owner_email, ''))) = LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')))
                )
            );
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

-- Reviews: Clients can create reviews for their approved Rentals (conditional)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_email')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'tenant_email') THEN
        DROP POLICY IF EXISTS "Clients can create reviews" ON reviews;
        CREATE POLICY "Clients can create reviews" ON reviews
            FOR INSERT TO authenticated
            WITH CHECK (
                LOWER(tenant_email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
                AND EXISTS (
                    SELECT 1 FROM Rentals 
                    WHERE Rentals.id = reviews.rental_id 
                    AND LOWER(Rentals.tenant_email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
                    AND Rentals.status = 'approved'
                )
            );
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_email')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Rentals' AND column_name = 'client_email') THEN
        -- Fallback to client_email for old schema
        DROP POLICY IF EXISTS "Clients can create reviews" ON reviews;
        CREATE POLICY "Clients can create reviews" ON reviews
            FOR INSERT TO authenticated
            WITH CHECK (
                LOWER(tenant_email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
                AND EXISTS (
                    SELECT 1 FROM Rentals 
                    WHERE Rentals.id = reviews.rental_id 
                    AND LOWER(Rentals.client_email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
                    AND Rentals.status = 'approved'
                )
            );
    END IF;
END $$;

-- Admin policies (assuming admin role check function exists)
DROP POLICY IF EXISTS "Admins can manage all data" ON vehicle_owner_profiles;
CREATE POLICY "Admins can manage all data" ON vehicle_owner_profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles 
            WHERE LOWER(user_roles.email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
            AND user_roles.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE LOWER(user_roles.email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
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
-- END OF CORE SCHEMA
-- ============================================================================

-- ============================================================================
-- 4) Vehicles.business_permit_url migration (supabase_schema_update.sql)
-- ============================================================================
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS business_permit_url TEXT;

-- ============================================================================
-- 5) Storage buckets + policies
-- ============================================================================

-- Ensure the storage buckets exist before policies are applied.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'tenant-verification',
    'tenant-verification',
    true,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  ),
  (
    'profile-images',
    'profile-images',
    true,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'vehicle-images',
    'vehicle-images',
    true,
    15728640,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  ),
  (
    'id-documents',
    'id-documents',
    true,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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
  AND (
    policyname LIKE '%profile-images%'
    OR policyname LIKE '%tenant-verification%'
    OR policyname LIKE '%vehicle-images%'
    OR policyname LIKE '%id-documents%'
  )
ORDER BY policyname;

-- Show message when done
SELECT 'Storage buckets and policies created successfully! Registration and vehicle uploads should now work.' as status;

