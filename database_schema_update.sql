-- Enhanced BoardingHub Database Schema
-- This script adds new tables and features for the comprehensive admin, owner, and client functionality

-- 1. Enhanced Vehicles table with additional fields
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'available';
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS rooms INTEGER DEFAULT 1;
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS max_occupancy INTEGER DEFAULT 1;
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS house_rules TEXT;
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS check_in_time TIME DEFAULT '14:00';
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS check_out_time TIME DEFAULT '12:00';
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS cancellation_policy TEXT;
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0.0;
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0;
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE Vehicles ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- 2. Reviews and Ratings table
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES Vehicles(id) ON DELETE CASCADE,
    client_email VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
    review_text TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enhanced Rentals table
ALTER TABLE Rentals ADD COLUMN IF NOT EXISTS check_in_date DATE;
ALTER TABLE Rentals ADD COLUMN IF NOT EXISTS check_out_date DATE;
ALTER TABLE Rentals ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2);
ALTER TABLE Rentals ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE Rentals ADD COLUMN IF NOT EXISTS special_requests TEXT;
ALTER TABLE Rentals ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- 4. vehicle Availability table
CREATE TABLE IF NOT EXISTS vehicle_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES Vehicles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    price_override DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id, date)
);

-- 5. Enhanced Notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type VARCHAR(50) DEFAULT 'general';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- 6. Admin Actions Log table
CREATE TABLE IF NOT EXISTS admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_email VARCHAR(255) NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL, -- 'vehicle', 'user', 'rental'
    target_id UUID NOT NULL,
    action_details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. vehicle Analytics table
CREATE TABLE IF NOT EXISTS vehicle_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES Vehicles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    views INTEGER DEFAULT 0,
    Rentals INTEGER DEFAULT 0,
    revenue DECIMAL(10,2) DEFAULT 0.0,
    occupancy_rate DECIMAL(5,2) DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id, date)
);

-- 8. Search Analytics table
CREATE TABLE IF NOT EXISTS search_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_query TEXT,
    location VARCHAR(255),
    filters JSONB,
    results_count INTEGER DEFAULT 0,
    user_email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. vehicle Favorites table
CREATE TABLE IF NOT EXISTS vehicle_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES Vehicles(id) ON DELETE CASCADE,
    client_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id, client_email)
);

-- 10. Enhanced User Profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(20),
    profile_image_url TEXT,
    bio TEXT,
    preferences JSONB,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. vehicle Reports table
CREATE TABLE IF NOT EXISTS vehicle_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES Vehicles(id) ON DELETE CASCADE,
    reporter_email VARCHAR(255) NOT NULL,
    report_type VARCHAR(50) NOT NULL, -- 'inappropriate', 'fraud', 'spam', 'other'
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved'
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_Vehicles_status ON Vehicles(status);
CREATE INDEX IF NOT EXISTS idx_Vehicles_rating ON Vehicles(rating DESC);
CREATE INDEX IF NOT EXISTS idx_Vehicles_featured ON Vehicles(is_featured);
CREATE INDEX IF NOT EXISTS idx_reviews_vehicle_id ON reviews(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_Rentals_status ON Rentals(status);
CREATE INDEX IF NOT EXISTS idx_Rentals_dates ON Rentals(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_email);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_email, read_at);
CREATE INDEX IF NOT EXISTS idx_availability_vehicle_date ON vehicle_availability(vehicle_id, date);
CREATE INDEX IF NOT EXISTS idx_analytics_vehicle_date ON vehicle_analytics(vehicle_id, date);
CREATE INDEX IF NOT EXISTS idx_favorites_client ON vehicle_favorites(client_email);
CREATE INDEX IF NOT EXISTS idx_reports_status ON vehicle_reports(status);

-- 13. Create triggers for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vehicle_reports_updated_at BEFORE UPDATE ON vehicle_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 14. Create function to update vehicle rating when reviews change
CREATE OR REPLACE FUNCTION update_vehicle_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE Vehicles 
        SET 
            rating = (
                SELECT COALESCE(AVG(rating), 0) 
                FROM reviews 
                WHERE vehicle_id = NEW.vehicle_id AND is_verified = TRUE
            ),
            total_reviews = (
                SELECT COUNT(*) 
                FROM reviews 
                WHERE vehicle_id = NEW.vehicle_id AND is_verified = TRUE
            )
        WHERE id = NEW.vehicle_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE Vehicles 
        SET 
            rating = (
                SELECT COALESCE(AVG(rating), 0) 
                FROM reviews 
                WHERE vehicle_id = OLD.vehicle_id AND is_verified = TRUE
            ),
            total_reviews = (
                SELECT COUNT(*) 
                FROM reviews 
                WHERE vehicle_id = OLD.vehicle_id AND is_verified = TRUE
            )
        WHERE id = OLD.vehicle_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_vehicle_rating_trigger
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_vehicle_rating();

-- 15. Create function to send notifications
CREATE OR REPLACE FUNCTION send_notification(
    recipient_email_param VARCHAR(255),
    title_param VARCHAR(255),
    body_param TEXT,
    notification_type_param VARCHAR(50) DEFAULT 'general',
    priority_param VARCHAR(20) DEFAULT 'normal',
    action_url_param TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    notification_id UUID;
BEGIN
    INSERT INTO notifications (
        recipient_email,
        title,
        body,
        notification_type,
        priority,
        action_url
    ) VALUES (
        recipient_email_param,
        title_param,
        body_param,
        notification_type_param,
        priority_param,
        action_url_param
    ) RETURNING id INTO notification_id;
    
    RETURN notification_id;
END;
$$ language 'plpgsql';

-- 16. Create function to log admin actions
CREATE OR REPLACE FUNCTION log_admin_action(
    admin_email_param VARCHAR(255),
    action_type_param VARCHAR(100),
    target_type_param VARCHAR(50),
    target_id_param UUID,
    action_details_param JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    action_id UUID;
BEGIN
    INSERT INTO admin_actions (
        admin_email,
        action_type,
        target_type,
        target_id,
        action_details
    ) VALUES (
        admin_email_param,
        action_type_param,
        target_type_param,
        target_id_param,
        action_details_param
    ) RETURNING id INTO action_id;
    
    RETURN action_id;
END;
$$ language 'plpgsql';

-- 17. Create RLS policies for security
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_reports ENABLE ROW LEVEL SECURITY;

-- Reviews: Users can only see verified reviews, owners can see all reviews for their Vehicles
CREATE POLICY "Reviews are viewable by everyone" ON reviews
    FOR SELECT USING (is_verified = TRUE);

CREATE POLICY "vehicle owners can see all reviews" ON reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM Vehicles 
            WHERE Vehicles.id = reviews.vehicle_id 
            AND Vehicles.owner_email = current_setting('app.current_user_email', true)
        )
    );

-- Favorites: Users can only manage their own favorites
CREATE POLICY "Users can manage their own favorites" ON vehicle_favorites
    FOR ALL USING (client_email = current_setting('app.current_user_email', true));

-- User profiles: Users can only manage their own profile
CREATE POLICY "Users can manage their own profile" ON user_profiles
    FOR ALL USING (user_email = current_setting('app.current_user_email', true));

-- vehicle reports: Users can only see their own reports
CREATE POLICY "Users can manage their own reports" ON vehicle_reports
    FOR ALL USING (reporter_email = current_setting('app.current_user_email', true));

-- 18. Insert sample data for testing
INSERT INTO user_profiles (user_email, full_name, phone, bio, is_verified) VALUES
('admin@boardinghub.com', 'Admin User', '+63-912-345-6789', 'System Administrator', TRUE),
('owner@example.com', 'vehicle Owner', '+63-912-345-6788', 'Experienced vehicle owner', TRUE),
('client@example.com', 'John Client', '+63-912-345-6787', 'Looking for a great place to stay', TRUE)
ON CONFLICT (user_email) DO NOTHING;

-- 19. Create views for common queries
CREATE OR REPLACE VIEW vehicle_summary AS
SELECT 
    p.id,
    p.title,
    p.description,
    p.price,
    p.location,
    p.rating,
    p.total_reviews,
    p.status,
    p.is_featured,
    p.owner_email,
    p.created_at,
    COUNT(b.id) as total_Rentals,
    COUNT(CASE WHEN b.status = 'approved' THEN 1 END) as approved_Rentals,
    COALESCE(AVG(pa.occupancy_rate), 0) as avg_occupancy_rate
FROM Vehicles p
LEFT JOIN Rentals b ON p.id = b.vehicle_id
LEFT JOIN vehicle_analytics pa ON p.id = pa.vehicle_id
GROUP BY p.id, p.title, p.description, p.price, p.location, p.rating, p.total_reviews, p.status, p.is_featured, p.owner_email, p.created_at;

CREATE OR REPLACE VIEW owner_dashboard_stats AS
SELECT 
    p.owner_email,
    COUNT(p.id) as total_Vehicles,
    COUNT(CASE WHEN p.status = 'available' THEN 1 END) as active_Vehicles,
    COUNT(b.id) as total_Rentals,
    COUNT(CASE WHEN b.status = 'pending' THEN 1 END) as pending_Rentals,
    COUNT(CASE WHEN b.status = 'approved' THEN 1 END) as approved_Rentals,
    COALESCE(SUM(b.total_amount), 0) as total_revenue,
    COALESCE(AVG(p.rating), 0) as avg_rating
FROM Vehicles p
LEFT JOIN Rentals b ON p.id = b.vehicle_id
GROUP BY p.owner_email;

-- 20. Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;


