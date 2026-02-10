-- 📊 SUPABASE_FIX.sql
-- Run this in the Supabase SQL Editor.

-- 1. FIX TABLE: Add missing 'category' column to 'trades' table (If not already done)
ALTER TABLE trades 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';

-- 2. CREATE LOGS TABLE (For Remote Debugging)
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    type TEXT, -- 'INFO', 'ERROR', 'SUCCESS', 'WARNING'
    message TEXT,
    metadata JSONB
);

-- 3. ENABLE RLS (Optional, for safety)
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read/write access for all users" ON system_logs FOR ALL USING (true);


-- 4. RE-CREATE VIEWS (To be safe)
CREATE OR REPLACE VIEW view_category_performance AS
SELECT 
    category,
    COUNT(*) as trade_count,
    SUM(pnl) as total_pnl,
    AVG(pnl_percent) * 100 as avg_roi_percent,
    (COUNT(CASE WHEN pnl > 0 THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100 as win_rate_percent
FROM trades
WHERE status = 'CLOSED'
GROUP BY category;

-- Debug Logs Table (for remote frontend diagnosis)
CREATE TABLE IF NOT EXISTS debug_logs (
    id BIGSERIAL PRIMARY KEY,
    source TEXT DEFAULT 'frontend',
    level TEXT DEFAULT 'debug',
    data TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
