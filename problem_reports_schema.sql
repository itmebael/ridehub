-- Problem Reports Table Schema
-- This table stores problem reports submitted by tenants and landlords

-- Create problem_reports table
CREATE TABLE IF NOT EXISTS problem_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- References auth.users(id)
    user_email VARCHAR(255) NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('client', 'owner')), -- 'client' for tenant, 'owner' for landlord
    vehicle_id UUID REFERENCES Vehicles(id) ON DELETE SET NULL, -- Optional: if problem is related to a specific vehicle
    problem_type VARCHAR(50) NOT NULL CHECK (problem_type IN ('technical', 'payment', 'vehicle', 'rental', 'account', 'other')),
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
    admin_notes TEXT, -- Admin can add notes when reviewing/resolving
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_problem_reports_user_id ON problem_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_problem_reports_user_email ON problem_reports(user_email);
CREATE INDEX IF NOT EXISTS idx_problem_reports_status ON problem_reports(status);
CREATE INDEX IF NOT EXISTS idx_problem_reports_vehicle_id ON problem_reports(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_problem_reports_created_at ON problem_reports(created_at DESC);

-- Create updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_problem_reports_updated_at ON problem_reports;
CREATE TRIGGER update_problem_reports_updated_at
    BEFORE UPDATE ON problem_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE problem_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Policy: Users can view their own problem reports
CREATE POLICY "Users can view their own problem reports" ON problem_reports
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own problem reports
CREATE POLICY "Users can insert their own problem reports" ON problem_reports
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can view all problem reports
-- Note: Adjust this based on your admin identification method
CREATE POLICY "Admins can view all problem reports" ON problem_reports
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM app_users
            WHERE app_users.user_id = auth.uid()
            AND app_users.role = 'admin'
        )
    );

-- Policy: Admins can update problem reports (for status changes, admin notes, etc.)
CREATE POLICY "Admins can update problem reports" ON problem_reports
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM app_users
            WHERE app_users.user_id = auth.uid()
            AND app_users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_users
            WHERE app_users.user_id = auth.uid()
            AND app_users.role = 'admin'
        )
    );

-- Optional: Grant necessary permissions
-- GRANT SELECT, INSERT ON problem_reports TO authenticated;
-- GRANT SELECT, UPDATE ON problem_reports TO authenticated;

-- Add comment to table
COMMENT ON TABLE problem_reports IS 'Stores problem reports submitted by tenants and landlords for admin review';

-- Add comments to columns
COMMENT ON COLUMN problem_reports.user_type IS 'Type of user: client (tenant) or owner (landlord)';
COMMENT ON COLUMN problem_reports.problem_type IS 'Type of problem: technical, payment, vehicle, rental, account, or other';
COMMENT ON COLUMN problem_reports.status IS 'Status of the report: pending, in_progress, resolved, or closed';
COMMENT ON COLUMN problem_reports.admin_notes IS 'Notes added by admin when reviewing or resolving the problem';



