
import express from 'express';
import { supabase } from '../services/supabaseService.js';
import { botState } from '../state.js';

const router = express.Router();

// Helper: compute analytics from local botState (works even without Supabase)
function computeLocalAnalytics() {
    const closed = botState.closedTrades || [];
    const active = botState.activeTrades || [];
    const allTrades = [...closed];

    const wins = allTrades.filter(t => (t.pnl || t.profit || 0) > 0);
    const losses = allTrades.filter(t => (t.pnl || t.profit || 0) <= 0);
    const totalPnl = allTrades.reduce((sum, t) => sum + (t.pnl || t.profit || 0), 0);
    const totalInvested = allTrades.reduce((sum, t) => sum + (t.amount || 0), 0);
    const winRate = allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0;
    const roi = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    // Category breakdown
    const categories = {};
    allTrades.forEach(t => {
        const cat = t.category || 'other';
        if (!categories[cat]) categories[cat] = { wins: 0, losses: 0, pnl: 0, count: 0 };
        categories[cat].count++;
        categories[cat].pnl += (t.pnl || t.profit || 0);
        if ((t.pnl || t.profit || 0) > 0) categories[cat].wins++;
        else categories[cat].losses++;
    });

    // Monthly breakdown
    const months = {};
    allTrades.forEach(t => {
        const date = t.closedAt || t.endTime || t.startTime;
        if (!date) return;
        const month = date.substring(0, 7); // YYYY-MM
        if (!months[month]) months[month] = { pnl: 0, trades: 0, wins: 0 };
        months[month].pnl += (t.pnl || t.profit || 0);
        months[month].trades++;
        if ((t.pnl || t.profit || 0) > 0) months[month].wins++;
    });

    // Strategy breakdown (from reasons)
    const strategies = {};
    allTrades.forEach(t => {
        let strategy = 'standard';
        const reasons = t.reasons || t.decisionReasons || [];
        const reasonStr = Array.isArray(reasons) ? reasons.join(' ') : String(reasons);
        if (reasonStr.includes('Wizard')) strategy = 'wizard';
        else if (reasonStr.includes('Whale')) strategy = 'whale';
        else if (reasonStr.includes('Arbitrage')) strategy = 'arbitrage';
        else if (reasonStr.includes('Momentum')) strategy = 'momentum';
        else if (reasonStr.includes('Fresh')) strategy = 'fresh_market';

        if (!strategies[strategy]) strategies[strategy] = { wins: 0, losses: 0, pnl: 0, count: 0, invested: 0 };
        strategies[strategy].count++;
        strategies[strategy].pnl += (t.pnl || t.profit || 0);
        strategies[strategy].invested += (t.amount || 0);
        if ((t.pnl || t.profit || 0) > 0) strategies[strategy].wins++;
        else strategies[strategy].losses++;
    });

    // Unrealized PnL from active trades
    const unrealizedPnl = active.reduce((sum, t) => {
        const currentVal = t.priceHistory && t.priceHistory.length > 0
            ? t.shares * t.priceHistory[t.priceHistory.length - 1]
            : t.amount || 0;
        return sum + (currentVal - (t.amount || 0));
    }, 0);

    return {
        global: {
            total_pnl: totalPnl,
            unrealized_pnl: unrealizedPnl,
            total_trades: allTrades.length,
            active_trades: active.length,
            win_rate: winRate,
            roi_percent: roi,
            avg_trade_pnl: allTrades.length > 0 ? totalPnl / allTrades.length : 0,
            best_trade: allTrades.length > 0 ? Math.max(...allTrades.map(t => t.pnl || t.profit || 0)) : 0,
            worst_trade: allTrades.length > 0 ? Math.min(...allTrades.map(t => t.pnl || t.profit || 0)) : 0,
            daily_pnl: botState.dailyPnL || 0
        },
        categories: Object.entries(categories).map(([cat, data]) => ({
            category: cat,
            trade_count: data.count,
            total_pnl: data.pnl,
            win_rate_percent: data.count > 0 ? (data.wins / data.count) * 100 : 0
        })).sort((a, b) => b.total_pnl - a.total_pnl),
        monthly: Object.entries(months).map(([month, data]) => ({
            month,
            monthly_pnl: data.pnl,
            trade_count: data.trades,
            win_rate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0
        })).sort((a, b) => a.month.localeCompare(b.month)),
        strategies: Object.entries(strategies).map(([strat, data]) => ({
            strategy: strat,
            trade_count: data.count,
            total_pnl: data.pnl,
            avg_roi_percent: data.invested > 0 ? (data.pnl / data.invested) * 100 : 0,
            win_rate_percent: data.count > 0 ? (data.wins / data.count) * 100 : 0
        })).sort((a, b) => b.total_pnl - a.total_pnl)
    };
}

// 1. GLOBAL PERFORMANCE
router.get('/global', async (req, res) => {
    try {
        // Try Supabase first
        if (supabase) {
            const { data, error } = await supabase
                .from('view_global_performance')
                .select('*')
                .single();
            if (!error && data) return res.json(data);
        }
        // Fallback: local data
        res.json(computeLocalAnalytics().global);
    } catch (err) {
        // Final fallback
        res.json(computeLocalAnalytics().global);
    }
});

// 2. CATEGORY PERFORMANCE
router.get('/category', async (req, res) => {
    try {
        if (supabase) {
            const { data, error } = await supabase
                .from('view_category_performance')
                .select('*')
                .order('total_pnl', { ascending: false });
            if (!error && data && data.length > 0) return res.json(data);
        }
        res.json(computeLocalAnalytics().categories);
    } catch (err) {
        res.json(computeLocalAnalytics().categories);
    }
});

// 3. STRATEGY PERFORMANCE
router.get('/strategy', async (req, res) => {
    try {
        if (supabase) {
            const { data, error } = await supabase
                .from('view_strategy_performance')
                .select('*')
                .order('total_pnl', { ascending: false });
            if (!error && data && data.length > 0) return res.json(data);
        }
        res.json(computeLocalAnalytics().strategies);
    } catch (err) {
        res.json(computeLocalAnalytics().strategies);
    }
});

// 4. MONTHLY PNL
router.get('/monthly', async (req, res) => {
    try {
        if (supabase) {
            const { data, error } = await supabase
                .from('view_monthly_pnl')
                .select('*')
                .order('month', { ascending: true });
            if (!error && data && data.length > 0) return res.json(data);
        }
        res.json(computeLocalAnalytics().monthly);
    } catch (err) {
        res.json(computeLocalAnalytics().monthly);
    }
});

export default router;
