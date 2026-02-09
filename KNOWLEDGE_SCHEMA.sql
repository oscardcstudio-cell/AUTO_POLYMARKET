
-- KNOWLEDGE BASE SCHEMA
-- Run this in Supabase SQL Editor

-- 1. Athletes Table
CREATE TABLE IF NOT EXISTS knowledge_athletes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    team TEXT,
    sport TEXT,
    status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'INJURED', 'SUSPENDED'
    rating INTEGER DEFAULT 80, -- 0-100 score
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Teams Table
CREATE TABLE IF NOT EXISTS knowledge_teams (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    league TEXT, -- 'NFL', 'NBA', etc.
    power_ranking INTEGER DEFAULT 50, -- 0-100
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Simulation/Training Logs
CREATE TABLE IF NOT EXISTS simulation_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    strategy_config JSONB, -- { "confidence_threshold": 0.6 }
    result_pnl NUMERIC,
    result_roi NUMERIC,
    trade_count INTEGER
);

-- 4. Enable Row Level Security (RLS) - Optional but good practice
ALTER TABLE knowledge_athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_runs ENABLE ROW LEVEL SECURITY;

-- 5. Policies (Public Read for now, Service Role Write)
CREATE POLICY "Enable read access for all users" ON knowledge_athletes FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON knowledge_teams FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON simulation_runs FOR SELECT USING (true);
