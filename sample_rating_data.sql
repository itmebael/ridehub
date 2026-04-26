-- Sample Rating Data for Boarding Houses
-- This file contains example data to demonstrate the rating system

-- Sample vehicle ratings (assuming you have Vehicles with IDs)
-- Note: Replace these UUIDs with actual vehicle IDs from your Vehicles table

-- Sample rating for vehicle 1
INSERT INTO public.vehicle_ratings (vehicle_id, user_id, rating, review_text, is_verified) VALUES
('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440011', 5, 'Excellent boarding house! Very clean, great location near the university, and the owner is very responsive. Highly recommended!', true),
('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440012', 4, 'Good value for money. The room is spacious and the amenities are decent. Only minor issue is the WiFi can be slow sometimes.', true),
('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440013', 5, 'Perfect for students! Close to campus, clean facilities, and the owner is very helpful. Will definitely stay here again.', true);

-- Sample rating for vehicle 2
INSERT INTO public.vehicle_ratings (vehicle_id, user_id, rating, review_text, is_verified) VALUES
('550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440014', 3, 'Average boarding house. The location is okay but the room is quite small. Price is reasonable though.', false),
('550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440015', 4, 'Good boarding house with nice amenities. The common areas are well-maintained and the staff is friendly.', true);

-- Sample rating for vehicle 3
INSERT INTO public.vehicle_ratings (vehicle_id, user_id, rating, review_text, is_verified) VALUES
('550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440016', 2, 'Not satisfied with this boarding house. The room was not clean when I arrived and the WiFi is very unreliable.', false),
('550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440017', 3, 'It''s okay for the price. The location is convenient but the facilities need improvement.', false);

-- Sample category ratings for the first vehicle rating
-- Get the category IDs first
DO $$
DECLARE
    cleanliness_id uuid;
    location_id uuid;
    value_id uuid;
    amenities_id uuid;
    safety_id uuid;
    communication_id uuid;
    checkin_id uuid;
    overall_id uuid;
    rating_id uuid;
BEGIN
    -- Get category IDs
    SELECT id INTO cleanliness_id FROM public.review_categories WHERE name = 'Cleanliness';
    SELECT id INTO location_id FROM public.review_categories WHERE name = 'Location';
    SELECT id INTO value_id FROM public.review_categories WHERE name = 'Value for Money';
    SELECT id INTO amenities_id FROM public.review_categories WHERE name = 'Amenities';
    SELECT id INTO safety_id FROM public.review_categories WHERE name = 'Safety';
    SELECT id INTO communication_id FROM public.review_categories WHERE name = 'Communication';
    SELECT id INTO checkin_id FROM public.review_categories WHERE name = 'Check-in Process';
    SELECT id INTO overall_id FROM public.review_categories WHERE name = 'Overall Experience';
    
    -- Get the first rating ID
    SELECT id INTO rating_id FROM public.vehicle_ratings WHERE vehicle_id = '550e8400-e29b-41d4-a716-446655440001' LIMIT 1;
    
    -- Insert category ratings
    INSERT INTO public.category_ratings (vehicle_rating_id, category_id, rating) VALUES
    (rating_id, cleanliness_id, 5),
    (rating_id, location_id, 5),
    (rating_id, value_id, 4),
    (rating_id, amenities_id, 4),
    (rating_id, safety_id, 5),
    (rating_id, communication_id, 5),
    (rating_id, checkin_id, 4),
    (rating_id, overall_id, 5);
END $$;

-- Sample helpfulness votes
DO $$
DECLARE
    rating_id uuid;
BEGIN
    -- Get a rating ID
    SELECT id INTO rating_id FROM public.vehicle_ratings LIMIT 1;
    
    -- Insert helpfulness votes
    INSERT INTO public.rating_helpfulness (vehicle_rating_id, user_id, is_helpful) VALUES
    (rating_id, '550e8400-e29b-41d4-a716-446655440018', true),
    (rating_id, '550e8400-e29b-41d4-a716-446655440019', true),
    (rating_id, '550e8400-e29b-41d4-a716-446655440020', false);
END $$;

-- Query to view the rating data
-- This query shows Vehicles with their rating statistics
SELECT 
    p.id,
    p.title,
    p.location,
    p.price,
    prs.total_ratings,
    prs.average_rating,
    prs.rating_1_count,
    prs.rating_2_count,
    prs.rating_3_count,
    prs.rating_4_count,
    prs.rating_5_count,
    prs.last_updated
FROM public.Vehicles p
LEFT JOIN public.vehicle_rating_stats prs ON p.id = prs.vehicle_id
ORDER BY prs.average_rating DESC, prs.total_ratings DESC;

-- Query to view individual reviews with category ratings
SELECT 
    p.title as vehicle_title,
    pr.rating as overall_rating,
    pr.review_text,
    pr.created_at,
    pr.is_verified,
    rc.name as category_name,
    cr.rating as category_rating
FROM public.vehicle_ratings pr
JOIN public.Vehicles p ON pr.vehicle_id = p.id
LEFT JOIN public.category_ratings cr ON pr.id = cr.vehicle_rating_id
LEFT JOIN public.review_categories rc ON cr.category_id = rc.id
ORDER BY pr.created_at DESC;

-- Query to view helpfulness statistics
SELECT 
    p.title as vehicle_title,
    pr.review_text,
    COUNT(rh.id) as total_votes,
    COUNT(rh.id) FILTER (WHERE rh.is_helpful = true) as helpful_votes,
    COUNT(rh.id) FILTER (WHERE rh.is_helpful = false) as not_helpful_votes,
    ROUND(
        COUNT(rh.id) FILTER (WHERE rh.is_helpful = true)::numeric / 
        NULLIF(COUNT(rh.id), 0) * 100, 2
    ) as helpfulness_percentage
FROM public.vehicle_ratings pr
JOIN public.Vehicles p ON pr.vehicle_id = p.id
LEFT JOIN public.rating_helpfulness rh ON pr.id = rh.vehicle_rating_id
GROUP BY p.title, pr.review_text, pr.id
ORDER BY helpfulness_percentage DESC;


