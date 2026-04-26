-- Rating System Schema for Boarding Houses
-- This creates tables for vehicle ratings, user reviews, and rating statistics

-- 1. vehicle Ratings Table
-- Stores individual ratings given by users to Vehicles
CREATE TABLE public.vehicle_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_verified boolean NOT NULL DEFAULT false,
  CONSTRAINT vehicle_ratings_pkey PRIMARY KEY (id),
  CONSTRAINT vehicle_ratings_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.Vehicles(id) ON DELETE CASCADE,
  CONSTRAINT vehicle_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT unique_user_vehicle_rating UNIQUE (vehicle_id, user_id)
) TABLESPACE pg_default;

-- 2. vehicle Rating Statistics Table
-- Stores aggregated rating statistics for each vehicle
CREATE TABLE public.vehicle_rating_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  total_ratings integer NOT NULL DEFAULT 0,
  average_rating numeric(3,2) NOT NULL DEFAULT 0.00,
  rating_1_count integer NOT NULL DEFAULT 0,
  rating_2_count integer NOT NULL DEFAULT 0,
  rating_3_count integer NOT NULL DEFAULT 0,
  rating_4_count integer NOT NULL DEFAULT 0,
  rating_5_count integer NOT NULL DEFAULT 0,
  last_updated timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_rating_stats_pkey PRIMARY KEY (id),
  CONSTRAINT vehicle_rating_stats_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.Vehicles(id) ON DELETE CASCADE,
  CONSTRAINT unique_vehicle_rating_stats UNIQUE (vehicle_id)
) TABLESPACE pg_default;

-- 3. User Review Categories Table
-- Stores different categories of reviews (cleanliness, location, value, etc.)
CREATE TABLE public.review_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT review_categories_pkey PRIMARY KEY (id),
  CONSTRAINT unique_category_name UNIQUE (name)
) TABLESPACE pg_default;

-- 4. Category Ratings Table
-- Stores ratings for specific categories within a review
CREATE TABLE public.category_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_rating_id uuid NOT NULL,
  category_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT category_ratings_pkey PRIMARY KEY (id),
  CONSTRAINT category_ratings_vehicle_rating_id_fkey FOREIGN KEY (vehicle_rating_id) REFERENCES public.vehicle_ratings(id) ON DELETE CASCADE,
  CONSTRAINT category_ratings_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.review_categories(id) ON DELETE CASCADE,
  CONSTRAINT unique_rating_category UNIQUE (vehicle_rating_id, category_id)
) TABLESPACE pg_default;

-- 5. Rating Helpfulness Table
-- Allows users to mark reviews as helpful or not helpful
CREATE TABLE public.rating_helpfulness (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_rating_id uuid NOT NULL,
  user_id uuid NOT NULL,
  is_helpful boolean NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rating_helpfulness_pkey PRIMARY KEY (id),
  CONSTRAINT rating_helpfulness_vehicle_rating_id_fkey FOREIGN KEY (vehicle_rating_id) REFERENCES public.vehicle_ratings(id) ON DELETE CASCADE,
  CONSTRAINT rating_helpfulness_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT unique_user_rating_helpfulness UNIQUE (vehicle_rating_id, user_id)
) TABLESPACE pg_default;

-- Insert default review categories
INSERT INTO public.review_categories (name, description) VALUES
('Cleanliness', 'How clean and well-maintained the vehicle is'),
('Location', 'Convenience and accessibility of the location'),
('Value for Money', 'Whether the price is reasonable for what you get'),
('Amenities', 'Quality and availability of facilities and amenities'),
('Safety', 'Security and safety of the vehicle and area'),
('Communication', 'How well the owner/manager communicates'),
('Check-in Process', 'Smoothness of the check-in experience'),
('Overall Experience', 'General satisfaction with the stay');

-- Create indexes for better performance
CREATE INDEX idx_vehicle_ratings_vehicle_id ON public.vehicle_ratings(vehicle_id);
CREATE INDEX idx_vehicle_ratings_user_id ON public.vehicle_ratings(user_id);
CREATE INDEX idx_vehicle_ratings_created_at ON public.vehicle_ratings(created_at);
CREATE INDEX idx_vehicle_rating_stats_vehicle_id ON public.vehicle_rating_stats(vehicle_id);
CREATE INDEX idx_category_ratings_vehicle_rating_id ON public.category_ratings(vehicle_rating_id);
CREATE INDEX idx_rating_helpfulness_vehicle_rating_id ON public.rating_helpfulness(vehicle_rating_id);

-- Create function to update rating statistics when a new rating is added
CREATE OR REPLACE FUNCTION update_vehicle_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update or insert rating statistics for the vehicle
  INSERT INTO public.vehicle_rating_stats (
    vehicle_id,
    total_ratings,
    average_rating,
    rating_1_count,
    rating_2_count,
    rating_3_count,
    rating_4_count,
    rating_5_count,
    last_updated
  )
  SELECT 
    NEW.vehicle_id,
    COUNT(*),
    ROUND(AVG(rating::numeric), 2),
    COUNT(*) FILTER (WHERE rating = 1),
    COUNT(*) FILTER (WHERE rating = 2),
    COUNT(*) FILTER (WHERE rating = 3),
    COUNT(*) FILTER (WHERE rating = 4),
    COUNT(*) FILTER (WHERE rating = 5),
    NOW()
  FROM public.vehicle_ratings
  WHERE vehicle_id = NEW.vehicle_id
  ON CONFLICT (vehicle_id) 
  DO UPDATE SET
    total_ratings = EXCLUDED.total_ratings,
    average_rating = EXCLUDED.average_rating,
    rating_1_count = EXCLUDED.rating_1_count,
    rating_2_count = EXCLUDED.rating_2_count,
    rating_3_count = EXCLUDED.rating_3_count,
    rating_4_count = EXCLUDED.rating_4_count,
    rating_5_count = EXCLUDED.rating_5_count,
    last_updated = EXCLUDED.last_updated;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update rating statistics
CREATE TRIGGER trigger_update_vehicle_rating_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_rating_stats();

-- Create function to update Vehicles table with rating info
CREATE OR REPLACE FUNCTION update_vehicle_rating_info()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the Vehicles table with rating information
  UPDATE public.Vehicles
  SET 
    rating = NEW.average_rating,
    total_reviews = NEW.total_ratings
  WHERE id = NEW.vehicle_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update Vehicles table when rating stats change
CREATE TRIGGER trigger_update_vehicle_rating_info
  AFTER INSERT OR UPDATE ON public.vehicle_rating_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_rating_info();

-- Enable Row Level Security (RLS)
ALTER TABLE public.vehicle_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_rating_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_helpfulness ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can read all ratings
CREATE POLICY "Anyone can read vehicle ratings" ON public.vehicle_ratings
  FOR SELECT USING (true);

-- Users can only insert their own ratings
CREATE POLICY "Users can insert their own ratings" ON public.vehicle_ratings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own ratings
CREATE POLICY "Users can update their own ratings" ON public.vehicle_ratings
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own ratings
CREATE POLICY "Users can delete their own ratings" ON public.vehicle_ratings
  FOR DELETE USING (auth.uid() = user_id);

-- Anyone can read rating statistics
CREATE POLICY "Anyone can read rating statistics" ON public.vehicle_rating_stats
  FOR SELECT USING (true);

-- Anyone can read review categories
CREATE POLICY "Anyone can read review categories" ON public.review_categories
  FOR SELECT USING (true);

-- Users can read category ratings
CREATE POLICY "Anyone can read category ratings" ON public.category_ratings
  FOR SELECT USING (true);

-- Users can insert category ratings for their own reviews
CREATE POLICY "Users can insert category ratings" ON public.category_ratings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vehicle_ratings 
      WHERE id = vehicle_rating_id AND user_id = auth.uid()
    )
  );

-- Users can read rating helpfulness
CREATE POLICY "Anyone can read rating helpfulness" ON public.rating_helpfulness
  FOR SELECT USING (true);

-- Users can insert/update their own helpfulness votes
CREATE POLICY "Users can manage their own helpfulness votes" ON public.rating_helpfulness
  FOR ALL USING (auth.uid() = user_id);


