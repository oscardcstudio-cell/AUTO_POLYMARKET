
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
        if (!categories[cat]) categories[cat] = { wins: 0, losses: 0, pnl: 0, count: 0, invested: 0 };
        categories[cat].count++;
        categories[cat].pnl += (t.pnl || t.profit || 0);
        categories[cat].invested += (t.amount || 0);
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

    // Strategy breakdown — use explicit trade.strategy field, fallback to reasons parsing
    const strategies = {};
    allTrades.forEach(t => {
        let strategy = t.strategy || 'standard';
        if (strategy === 'standard') {
            // Fallback: parse from reasons for older trades without strategy field
            const reasons = t.reasons || t.decisionReasons || [];
            const reasonStr = Array.isArray(reasons) ? reasons.join(' ') : String(reasons);
            if (reasonStr.includes('Arbitrage')) strategy = 'arbitrage';
            else if (reasonStr.includes('Wizard')) strategy = 'wizard';
            else if (reasonStr.includes('Whale')) strategy = 'whale';
            else if (reasonStr.includes('DCA')) strategy = 'dca';
            else if (reasonStr.includes('DEFCON')) strategy = 'defcon';
            else if (reasonStr.includes('Memory') || reasonStr.includes('momentum')) strategy = 'memory';
            else if (reasonStr.includes('Catalyst') || reasonStr.includes('Event')) strategy = 'event_driven';
            else if (reasonStr.includes('Hype Fader')) strategy = 'hype_fader';
            else if (reasonStr.includes('Smart Momentum')) strategy = 'smart_momentum';
            else if (reasonStr.includes('Trend Following')) strategy = 'trend_following';
            else if (reasonStr.includes('Fresh')) strategy = 'fresh_market';
            else if (reasonStr.includes('Contrarian')) strategy = 'contrarian';
        }

        // Track conviction level as secondary tag
        const convScore = t.convictionScore || 0;

        if (!strategies[strategy]) strategies[strategy] = { wins: 0, losses: 0, pnl: 0, count: 0, invested: 0, avgConviction: 0, totalConviction: 0 };
        strategies[strategy].count++;
        strategies[strategy].pnl += (t.pnl || t.profit || 0);
        strategies[strategy].invested += (t.amount || 0);
        strategies[strategy].totalConviction += convScore;
        strategies[strategy].avgConviction = strategies[strategy].totalConviction / strategies[strategy].count;
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
            win_rate_percent: winRate,
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
            avg_roi_percent: data.invested > 0 ? (data.pnl / data.invested) * 100 : 0,
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
            win_rate_percent: data.count > 0 ? (data.wins / data.count) * 100 : 0,
            avg_conviction: Math.round(data.avgConviction || 0)
        })).sort((a, b) => b.total_pnl - a.total_pnl)
    };
}

// 1. GLOBAL PERFORMANCE
// Priority: Supabase (has full history) → local fallback
router.get('/global', async (req, res) => {
    try {
        if (supabase) {
            const { data, error } = await supabase
                .from('view_global_performance')
                .select('*')
                .single();
            if (!error && data) return res.json(data);
        }
        res.json(computeLocalAnalytics().global);
    } catch (err) {
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
// Compute from raw trades since view_strategy_performance doesn't exist in Supabase
router.get('/strategy', async (req, res) => {
    try {
        if (supabase) {
            const { data: trades, error } = await supabase
                .from('trades')
                .select('strategy, pnl, amount')
                .eq('status', 'CLOSED');
            if (!error && trades && trades.length > 0) {
                const strategies = {};
                // Normalize strategy names to match analytics card data-strategy attributes
                const nameMap = { 'copy_trade': 'copy' };
                for (const t of trades) {
                    const raw = t.strategy || 'standard';
                    const s = nameMap[raw] || raw;
                    if (!strategies[s]) strategies[s] = { wins: 0, count: 0, pnl: 0, invested: 0 };
                    strategies[s].count++;
                    strategies[s].pnl += (t.pnl || 0);
                    strategies[s].invested += (t.amount || 0);
                    if ((t.pnl || 0) > 0) strategies[s].wins++;
                }
                const result = Object.entries(strategies).map(([strat, d]) => ({
                    strategy: strat,
                    trade_count: d.count,
                    total_pnl: d.pnl,
                    avg_roi_percent: d.invested > 0 ? (d.pnl / d.invested) * 100 : 0,
                    win_rate_percent: d.count > 0 ? (d.wins / d.count) * 100 : 0,
                    avg_conviction: 0
                })).sort((a, b) => b.total_pnl - a.total_pnl);
                return res.json(result);
            }
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

// 5. INTELLIGENCE INFLUENCE — how often each intelligence strategy influenced trades
router.get('/intelligence', async (req, res) => {
    try {
        if (supabase) {
            const { data: trades, error } = await supabase
                .from('trades')
                .select('metadata, pnl')
                .eq('status', 'CLOSED');
            if (!error && trades && trades.length > 0) {
                const intel = {
                    'news':           { patterns: ['NewsMatch', 'News', 'headline', 'sentiment'], count: 0, wins: 0, pnl: 0 },
                    'cross_market':   { patterns: ['CrossMarket', 'Correlation penalty', 'Diversity bonus'], count: 0, wins: 0, pnl: 0 },
                    'smart_entry':    { patterns: ['Timing: Price', 'below avg', 'above recent avg'], count: 0, wins: 0, pnl: 0 },
                    'tension':        { patterns: ['pizzint', 'DEFCON', 'PizzINT', 'ELEVATED', 'HIGH mode', 'CRITICAL'], count: 0, wins: 0, pnl: 0 },
                    'memory':         { patterns: ['Memory:', 'accelerating', 'support detected', 'resistance detected'], count: 0, wins: 0, pnl: 0 },
                    'event':          { patterns: ['Event:', 'Catalyst', 'volume_spike', 'volume spike'], count: 0, wins: 0, pnl: 0 },
                    'calendar':       { patterns: ['Calendar:', 'off-hours', 'weekend', 'Advanced Size'], count: 0, wins: 0, pnl: 0 },
                    'anti_fragility': { patterns: ['Recovery Tier', 'Anti-Fragility', 'fragility', 'drawdown'], count: 0, wins: 0, pnl: 0 },
                    'ai_adapt':       { patterns: ['AI Adaptation', 'AI Feedback', 'Self-Training'], count: 0, wins: 0, pnl: 0 },
                };
                for (const t of trades) {
                    const reasons = Array.isArray((t.metadata || {}).reasons) ? t.metadata.reasons.join(' ') : '';
                    for (const [, cfg] of Object.entries(intel)) {
                        if (cfg.patterns.some(p => reasons.includes(p))) {
                            cfg.count++;
                            cfg.pnl += (t.pnl || 0);
                            if ((t.pnl || 0) > 0) cfg.wins++;
                        }
                    }
                }
                const total = trades.length;
                const result = Object.entries(intel).map(([key, d]) => ({
                    strategy: key,
                    influenced_trades: d.count,
                    total_trades: total,
                    influence_percent: total > 0 ? (d.count / total * 100) : 0,
                    win_rate_percent: d.count > 0 ? (d.wins / d.count * 100) : 0,
                    total_pnl: d.pnl,
                })).sort((a, b) => b.influenced_trades - a.influenced_trades);
                return res.json(result);
            }
        }
        res.json([]);
    } catch (err) {
        res.json([]);
    }
});

export default router;
