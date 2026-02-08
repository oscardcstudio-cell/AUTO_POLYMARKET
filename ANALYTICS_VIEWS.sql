-- 📊 ANALYTICS_VIEWS.sql
-- Run this in the Supabase SQL Editor to create powerful analytics views for your bot.

-- 1. VIEW: Global Performance (PnL Total, Winrate, Volume)
CREATE OR REPLACE VIEW view_global_performance AS
SELECT 
    COUNT(*) as total_trades,
    COUNT(CASE WHEN pnl > 0 THEN 1 END) as winning_trades,
    COUNT(CASE WHEN pnl < 0 THEN 1 END) as losing_trades,
    SUM(pnl) as total_pnl,
    AVG(pnl) as avg_pnl_per_trade,
    (COUNT(CASE WHEN pnl > 0 THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100 as win_rate_percent,
    SUM(amount) as total_volume
FROM trades
WHERE status = 'CLOSED';

-- 2. VIEW: Performance by Category (Sport, Crypto, Politics, etc.)
CREATE OR REPLACE VIEW view_category_performance AS
SELECT 
    category,
    COUNT(*) as trade_count,
    SUM(pnl) as total_pnl,
    AVG(pnl_percent) * 100 as avg_roi_percent,
    (COUNT(CASE WHEN pnl > 0 THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100 as win_rate_percent
FROM trades
WHERE status = 'CLOSED'
GROUP BY category
ORDER BY total_pnl DESC;

-- 3. VIEW: Strategy Effectiveness (Which strategy works best?)
CREATE OR REPLACE VIEW view_strategy_performance AS
SELECT 
    strategy,
    COUNT(*) as trade_count,
    SUM(pnl) as total_pnl,
    AVG(pnl) as avg_pnl,
    MAX(pnl) as max_win,
    MIN(pnl) as max_loss
FROM trades
WHERE status = 'CLOSED'
GROUP BY strategy
ORDER BY total_pnl DESC;

-- 4. VIEW: Monthly PnL (For tracking progress over time)
CREATE OR REPLACE VIEW view_monthly_pnl AS
SELECT 
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as trade_count,
    SUM(pnl) as total_pnl
FROM trades
WHERE status = 'CLOSED'
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

