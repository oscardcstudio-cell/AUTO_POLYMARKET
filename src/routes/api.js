
import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';
import { simulateTrade } from '../logic/engine.js';
import { getRelevantMarkets } from '../logic/signals.js';
import { supabase } from '../services/supabaseService.js';
import { getCLOBMidpoint, getCLOBPrice } from '../api/clob_api.js';

const router = express.Router();

// --- API ENDPOINTS ---

router.get('/bot-data', (req, res) => {
    try {
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Derived stats for dashboard
        const profit = botState.capital - botState.startingCapital;
        const profitPercent = ((profit) / botState.startingCapital * 100).toFixed(2);

        // Sanitize response: Exclude heavy data that has its own endpoint (marketCache)
        // Also exclude deepScanData if it's too large, but it's usually small metadata.
        const { marketCache, ...lightState } = botState;

        const data = {
            ...lightState,
            profit,
            profitPercent
        };



        // ROBUST SAFE SERIALIZATION (BigInt + Circular Refs)
        const getSafeReplacer = () => {
            const seen = new WeakSet();
            return (key, value) => {
                if (typeof value === "object" && value !== null) {
                    if (seen.has(value)) {
                        return '[Circular]';
                    }
                    seen.add(value);
                }
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            };
        };

        const jsonString = JSON.stringify(data, getSafeReplacer());

        res.setHeader('Content-Type', 'application/json');
        res.send(jsonString);
    } catch (error) {
        console.error("Error serving /bot-data:", error);
        res.status(500).json({ error: "Internal Server Error serving bot data" });
    }
});

// Endpoint pour réinitialiser la simulation
router.post('/reset', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    // ARCHIVE trades to Supabase before clearing
    const allTrades = [
        ...botState.closedTrades,
        ...botState.activeTrades.map(t => ({ ...t, status: 'FORCE_CLOSED', closeReason: 'RESET' }))
    ];

    if (allTrades.length > 0 && supabase) {
        try {
            const archiveRows = allTrades.map(t => ({
                id: t.id,
                market_id: t.marketId,
                question: t.question,
                side: t.side,
                amount: t.amount || 0,
                entry_price: t.entryPrice || 0,
                exit_price: t.exitPrice || 0,
                profit: t.profit || t.pnl || 0,
                shares: t.shares || 0,
                confidence: t.confidence || 0,
                category: t.category || 'unknown',
                status: t.status || 'CLOSED',
                close_reason: t.closeReason || t.resolvedOutcome || 'RESET',
                start_time: t.startTime || null,
                end_time: t.endTime || t.closedAt || new Date().toISOString(),
                archived_at: new Date().toISOString(),
                raw_data: t
            }));

            const { error } = await supabase.from('trade_archive').upsert(archiveRows, { onConflict: 'id' });
            if (error) console.error('Archive error:', error.message);
            else console.log(`✅ Archived ${archiveRows.length} trades before reset`);
        } catch (e) {
            console.error('Archive failed:', e.message);
        }
    }

    // Resetting State
    Object.assign(botState, {
        startTime: new Date().toISOString(),
        capital: (CONFIG && CONFIG.STARTING_CAPITAL) ? CONFIG.STARTING_CAPITAL : 1000,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        activeTrades: [],
        closedTrades: [],
        capitalHistory: [],
        lastPizzaData: null,
        topSignal: null,
        lastUpdate: new Date().toISOString(),
        logs: [],
        whaleAlerts: [],
        arbitrageOpportunities: [],
        newsSentiment: [],
        momentumData: {},
        apiStatus: {
            gamma: 'Checking...',
            clob: 'Checking...',
            pizzint: 'Checking...',
            alpha: 'Checking...'
        },
        wizards: [],
        freshMarkets: [],
        marketCache: []
    });

    addLog(botState, '♻️ SIMULATION RESET: Portefeuille réinitialisé à $1000', 'warning');

    // PERSISTENCE FIX
    stateManager.save();

    res.json({ success: true, message: 'Simulation reset. Trades archived to Supabase.' });


    // Delete trade history file if exists
    const historyFile = path.join(process.cwd(), 'trade_decisions.jsonl');
    if (fs.existsSync(historyFile)) {
        try {
            fs.unlinkSync(historyFile);
            addLog(botState, '📂 Historique des trades effacé', 'warning');
        } catch (e) {
            console.error("Failed to delete history file, trying to truncate:", e);
            try {
                fs.writeFileSync(historyFile, '');
                addLog(botState, '📂 Historique des trades vidé (truncate)', 'warning');
            } catch (e2) {
                console.error("Failed to truncate history file:", e2);
                addLog(botState, '❌ Erreur suppression historique: ' + e2.message, 'error');
            }
        }
    }

    stateManager.save();

    console.log(`✅ RESET COMPLETE. Capital: $${botState.capital}`);
    res.json({ success: true, message: "Simulation reset successful", capital: botState.capital });
});

// Health check endpoint pour Railway
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        lastHeartbeat: botState.lastHeartbeat || null,
        capital: botState.capital,
        activeTrades: botState.activeTrades.length
    });
});

router.get('/health-db', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ status: 'error', message: 'Supabase client not initialized (check env vars)' });
        }
        const { data, error } = await supabase.from('trades').select('count').limit(1);
        if (error) throw error;

        res.json({
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({
            status: 'error',
            message: e.message,
            hint: 'Check SUPABASE_URL and SUPABASE_KEY in Railway Variables'
        });
    }
});

// --- BACKLOG ENDPOINTS ---

router.get('/backlog', (req, res) => {
    res.json(botState.backlog || []);
});

router.post('/backlog', async (req, res) => {
    const { title, description, priority, type } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const newItem = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        timestamp: new Date().toISOString(),
        title,
        description: description || '',
        priority: priority || 'medium', // low, medium, high
        type: type || 'idea', // idea, bug
        status: 'open' // open, resolved
    };

    if (!botState.backlog) botState.backlog = [];
    botState.backlog.unshift(newItem);
    await stateManager.save();

    addLog(botState, `📝 Nouveau ${type}: ${title}`, 'info');
    res.json(newItem);
});

router.patch('/backlog/:id', async (req, res) => {
    const { id } = req.params;
    const { status, title, description, priority } = req.body;

    const item = botState.backlog.find(b => b.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (status) item.status = status;
    if (title) item.title = title;
    if (description) item.description = description;
    if (priority) item.priority = priority;

    await stateManager.save();
    res.json(item);
});

router.delete('/backlog/:id', async (req, res) => {
    const { id } = req.params;
    const index = botState.backlog.findIndex(b => b.id === id);
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    botState.backlog.splice(index, 1);
    await stateManager.save();
    res.json({ success: true });
});

// --- NEW: Full Trade History Endpoint ---
router.get('/trade-history', async (req, res) => {
    try {
        // PRODUCTION FIX: Read from Supabase instead of local file (Railway doesn't have trade_decisions.jsonl)
        const { supabaseService } = await import('../services/supabaseService.js');

        if (supabaseService && supabaseService.loadRecentTrades) {
            const trades = await supabaseService.loadRecentTrades(100);

            // Format for dashboard compatibility
            const formattedTrades = trades.map(t => ({
                timestamp: t.created_at,
                marketId: t.market_id,
                question: t.question,
                category: t.metadata?.category || 'other',
                side: t.side,
                amount: t.amount,
                entryPrice: t.entry_price,
                exitPrice: t.exit_price,
                pnl: t.pnl,
                status: t.status,
                confidence: t.confidence,
                tradeExecuted: true,
                decisionReasons: t.metadata?.reasons || []
            }));

            res.json(formattedTrades);
        } else {
            // Fallback: try local file if Supabase not available
            const historyFile = path.join(process.cwd(), 'trade_decisions.jsonl');
            if (fs.existsSync(historyFile)) {
                const fileContent = fs.readFileSync(historyFile, 'utf-8');
                const trades = fileContent
                    .split('\n')
                    .filter(line => line.trim() !== '')
                    .map(line => {
                        try { return JSON.parse(line); } catch (e) { return null; }
                    })
                    .filter(t => t !== null && t.tradeExecuted === true)
                    .reverse();
                res.json(trades);
            } else {
                res.json([]);
            }
        }
    } catch (error) {
        console.error("Error reading trade history:", error);
        res.status(500).json({ error: "Failed to read history" });
    }
});

// --- NEW: Marketplace Data ---
router.get('/markets', (req, res) => {
    // Serve cached deep scan data
    // Lightweight mapping to reduce payload size if needed, but 1000 items is fine.
    // Let's send key fields for the table.

    const markets = (botState.marketCache || []).map(m => {
        let parsedPrices = [0, 0];
        try {
            parsedPrices = m.outcomePrices ? JSON.parse(m.outcomePrices) : [0, 0];
        } catch (e) {
            console.error(`Invalid prices for market ${m.id}:`, m.outcomePrices, e);
            parsedPrices = [0, 0];
        }

        return {
            id: m.id,
            question: m.question,
            slug: m.slug,
            volume: parseFloat(m.volume24hr || 0),
            liquidity: parseFloat(m.liquidityNum || 0),
            prices: parsedPrices,
            endDate: m.endDate,
            category: m.category || 'other'
        };
    });

    res.json({
        lastScan: botState.deepScanData?.lastScan || null,
        count: markets.length,
        markets: markets
    });
});

// Backtest Results Endpoint
router.get('/backtest-results', async (req, res) => {
    try {
        if (!supabase) {
            return res.json({ runs: [] });
        }

        const { data, error } = await supabase
            .from('simulation_runs')
            .select('*')
            .order('run_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        const runs = (data || []).map(run => ({
            timestamp: run.run_at,
            roi: run.result_roi || 0,
            sharpe: run.strategy_config?.sharpeRatio || 0,
            winrate: run.strategy_config?.winrate || 0,
            drawdown: run.strategy_config?.maxDrawdown || 0,
            trade_count: run.trade_count || 0
        }));

        res.json({ runs });
    } catch (error) {
        console.error('Backtest results error:', error);
        res.json({ runs: [] });
    }
});

// Archived trades endpoint (for Live Performance mode)
router.get('/trade-archive', async (req, res) => {
    try {
        if (!supabase) return res.json({ trades: [] });

        const { data, error } = await supabase
            .from('trade_archive')
            .select('*')
            .order('archived_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        // Map back to closedTrades format for the frontend
        const trades = (data || []).map(row => ({
            id: row.id,
            marketId: row.market_id,
            question: row.question,
            side: row.side,
            amount: parseFloat(row.amount) || 0,
            entryPrice: parseFloat(row.entry_price) || 0,
            exitPrice: parseFloat(row.exit_price) || 0,
            profit: parseFloat(row.profit) || 0,
            pnl: parseFloat(row.profit) || 0,
            shares: parseFloat(row.shares) || 0,
            confidence: parseFloat(row.confidence) || 0,
            category: row.category,
            status: row.status,
            closeReason: row.close_reason,
            startTime: row.start_time,
            endTime: row.end_time,
            closedAt: row.end_time,
            archivedAt: row.archived_at
        }));

        res.json({ trades });
    } catch (error) {
        console.error('Trade archive error:', error);
        res.json({ trades: [] });
    }
});

// --- NEW: CLOB Price Verification Endpoint ---
router.get('/verify-clob-prices', async (req, res) => {
    try {
        const localTrades = botState.activeTrades || [];
        let remoteTrades = [];

        // 1. Fetch from Supabase
        if (supabase) {
            const { data, error } = await supabase
                .from('trades')
                .select('*')
                .eq('status', 'OPEN')
                .limit(50);
            if (!error) remoteTrades = data || [];
        }

        // 2. Merge and Deduplicate
        const allTrades = [...localTrades];
        remoteTrades.forEach(rt => {
            const marketId = rt.market_id;
            if (!allTrades.find(lt => lt.marketId === marketId || lt.id === marketId)) {
                allTrades.push({
                    marketId: rt.market_id,
                    question: rt.question,
                    entryPrice: rt.entry_price,
                    clobTokenIds: rt.metadata?.clobTokenIds || [],
                    slug: rt.metadata?.slug,
                    side: rt.side,
                    source: 'SUPABASE'
                });
            }
        });

        const results = [];
        const marketCache = botState.marketCache || [];

        for (const trade of allTrades) {
            const entry = trade.entryPrice || 0;
            const side = trade.side || 'YES';
            let livePrice = null;
            let source = 'N/A';
            let tokenIds = trade.clobTokenIds;

            // Recovery 1: Market Cache
            if (!tokenIds || tokenIds.length === 0) {
                const cached = marketCache.find(m => m.id === trade.marketId || m.question === trade.question || m.slug === trade.slug);
                if (cached && cached.clobTokenIds) {
                    tokenIds = cached.clobTokenIds;
                    if (typeof tokenIds === 'string') {
                        try { tokenIds = JSON.parse(tokenIds); } catch (e) { tokenIds = []; }
                    }
                }
            }

            // Fetch Live
            if (tokenIds && tokenIds.length === 2) {
                const tokenId = side === 'YES' ? tokenIds[0] : tokenIds[1];
                try {
                    livePrice = await getCLOBMidpoint(tokenId);
                    if (!livePrice) livePrice = await getCLOBPrice(tokenId);
                    if (livePrice) source = 'CLOB';
                } catch (e) { }
            }

            // Fallback: Gamma
            if (!livePrice && trade.marketId) {
                try {
                    const gRes = await fetch(`https://gamma-api.polymarket.com/markets/${trade.marketId}`);
                    if (gRes.ok) {
                        const gData = await gRes.json();
                        const prices = JSON.parse(gData.outcomePrices || '[0,0]');
                        livePrice = side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
                        source = 'GAMMA';
                    }
                } catch (e) { }
            }

            results.push({
                question: trade.question,
                side: side,
                entryPrice: entry,
                livePrice: livePrice,
                source: source,
                diffPercent: (livePrice && entry > 0) ? ((livePrice - entry) / entry * 100) : null
            });
        }

        res.json({ success: true, results });
    } catch (error) {
        console.error('Verification API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- NEW: Pulse Animation Endpoint ---
router.get('/pulses', (req, res) => {
    const pulses = botState.pulses || [];
    botState.pulses = []; // Clear queue after reading
    res.json({ pulses });
});

export default router;
