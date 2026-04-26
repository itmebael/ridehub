-- Vehicles Table Schema
-- This creates the Vehicles table with the exact structure provided

-- Drop existing Vehicles table if it exists (be careful in production!)
DROP TABLE IF EXISTS public.Vehicles CASCADE;

-- Create the Vehicles table with the exact structure
CREATE TABLE public.Vehicles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NULL,
  title text NOT NULL,
  description text NOT NULL,
  price integer NOT NULL,
  location text NOT NULL,
  amenities text[] NOT NULL DEFAULT '{}'::text[],
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  images text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'available'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  owner_email text NULL,
  CONSTRAINT Vehicles_pkey PRIMARY KEY (id),
  CONSTRAINT Vehicles_status_check CHECK (
    (status = ANY (ARRAY['available'::text, 'full'::text]))
  )
) TABLESPACE pg_default;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_Vehicles_status ON public.Vehicles(status);
CREATE INDEX IF NOT EXISTS idx_Vehicles_owner_email ON public.Vehicles(owner_email);
CREATE INDEX IF NOT EXISTS idx_Vehicles_created_at ON public.Vehicles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_Vehicles_location ON public.Vehicles(location);

-- Add RLS (Row Level Security) policies
ALTER TABLE public.Vehicles ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read available Vehicles
CREATE POLICY "Vehicles are viewable by everyone" ON public.Vehicles
  FOR SELECT USING (status = 'available');

-- Policy: Owners can manage their own Vehicles
CREATE POLICY "Owners can manage their own Vehicles" ON public.Vehicles
  FOR ALL USING (owner_email = current_setting('app.current_user_email', true));

-- Policy: Admins can manage all Vehicles
CREATE POLICY "Admins can manage all Vehicles" ON public.Vehicles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users 
      WHERE app_users.user_id = current_setting('app.current_user_id', true)
      AND app_users.role = 'admin'
    )
  );

-- Insert some sample data for testing
INSERT INTO public.Vehicles (
  title, 
  description, 
  price, 
  location, 
  amenities, 
  lat, 
  lng, 
  images, 
  status, 
  owner_email
) VALUES 
(
  'Cozy Studio Apartment',
  'A beautiful studio apartment in the heart of the city with modern amenities and great location.',
  15000,
  'Catbalogan City, Samar',
  ARRAY['WiFi', 'Air Conditioning', 'Private Kitchen', 'Parking'],
  11.7778,
  124.8847,
  ARRAY['sample-image-1.jpg'],
  'available',
  'owner@example.com'
),
(
  'Modern 2-Bedroom Unit',
  'Spacious 2-bedroom unit perfect for students or young professionals. Near university and shopping centers.',
  25000,
  'Catbalogan City, Samar',
  ARRAY['WiFi', 'Air Conditioning', 'Shared Kitchen', 'Laundry', 'Security'],
  11.7780,
  124.8850,
  ARRAY['sample-image-2.jpg'],
  'available',
  'owner@example.com'
),
(
  'Budget-Friendly Room',
  'Affordable single room with shared facilities. Perfect for budget-conscious tenants.',
  8000,
  'Catbalogan City, Samar',
  ARRAY['WiFi', 'Shared Kitchen', 'Laundry'],
  11.7775,
  124.8845,
  ARRAY['sample-image-3.jpg'],
  'available',
  'owner2@example.com'
);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.Vehicles TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


