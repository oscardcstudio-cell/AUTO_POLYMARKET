
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

const router = express.Router();

// --- API ENDPOINTS ---

router.get('/bot-data', (req, res) => {
    try {
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Derived stats for dashboard — use TOTAL capital (cash + invested) for accurate P&L
        const investedInTrades = (botState.activeTrades || [])
            .reduce((sum, t) => sum + (t.amount || 0), 0);
        const totalPortfolioValue = botState.capital + investedInTrades;
        const profit = totalPortfolioValue - botState.startingCapital;
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

// Endpoint pour réinitialiser la TOTALITÉ du système (Supabase + Local)
router.post('/reset', async (req, res) => {
    console.log("💣 TOTAL RESET TRIGGERED via API");
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 1. CLEAR SUPABASE (Using internal client which has full permissions)
    if (supabase) {
        try {
            console.log("🧹 Wiping Supabase tables...");

            // Delete all from trades
            const { error: e1 } = await supabase.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            if (e1) console.error("❌ Trades wipe error:", e1.message);

            // Delete all from bot_state
            const { error: e2 } = await supabase.from('bot_state').delete().neq('id', 'placeholder');
            if (e2) console.error("❌ Bot state wipe error:", e2.message);

            // Delete all from simulation_runs
            const { error: e3 } = await supabase.from('simulation_runs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            if (e3) console.error("❌ Sim runs wipe error:", e3.message);

            console.log("✅ Supabase tables cleared.");
        } catch (e) {
            console.error("❌ Deep DB Wipe failed:", e.message);
        }
    }

    // 2. Resetting State in Memory
    Object.assign(botState, {
        startTime: new Date().toISOString(),
        capital: 1000,
        startingCapital: 1000,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        activeTrades: [],
        closedTrades: [],
        capitalHistory: [],
        lastPizzaData: null,
        topSignal: null,
        lastUpdate: new Date().toISOString(),
        logs: [{ timestamp: new Date().toISOString(), message: "🚀 Système réinitialisé à $1000.", type: "success" }],
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

    // 3. PERSISTENCE FIX (Updates bot_data.json and saves the now-empty bot_state table)
    stateManager.save();

    // 4. Delete log files
    const historyFile = path.join(process.cwd(), 'trade_decisions.jsonl');
    if (fs.existsSync(historyFile)) {
        try { fs.unlinkSync(historyFile); } catch (e) { console.error("History file delete failed"); }
    }

    console.log(`✨ RESET COMPLETE. Capital: $${botState.capital}`);
    res.json({ success: true, message: "Système totalement réinitialisé (DB + Local)", capital: botState.capital });
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

router.post('/backlog', (req, res) => {
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
    stateManager.save();

    addLog(botState, `📝 Nouveau ${type}: ${title}`, 'info');
    res.json(newItem);
});

router.patch('/backlog/:id', (req, res) => {
    const { id } = req.params;
    const { status, title, description, priority } = req.body;

    const item = botState.backlog.find(b => b.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (status) item.status = status;
    if (title) item.title = title;
    if (description) item.description = description;
    if (priority) item.priority = priority;

    stateManager.save();
    res.json(item);
});

router.delete('/backlog/:id', (req, res) => {
    const { id } = req.params;
    const index = botState.backlog.findIndex(b => b.id === id);
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    botState.backlog.splice(index, 1);
    stateManager.save();
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

/**
 * POST /api/force-resync
 * Forces the bot to rebuild its state from Supabase trades table.
 * Useful after wallet resets or state corruption.
 */
router.post('/force-resync', async (req, res) => {
    try {
        addLog(botState, '🔄 Force resync requested via API...', 'warning');
        const recovered = await stateManager.tryRecovery();

        if (!recovered) {
            // tryRecovery didn't trigger — force a full reset to $1000
            stateManager.reset();
            addLog(botState, '✅ FORCE RESYNC: Reset complet à $1000', 'success');
            return res.json({
                success: true,
                message: 'Full reset to $1000',
                capital: botState.capital,
                activeTrades: botState.activeTrades.length,
                totalTrades: botState.totalTrades
            });
        }

        res.json({
            success: true,
            message: 'Recovery triggered successfully',
            capital: botState.capital,
            activeTrades: botState.activeTrades.length,
            totalTrades: botState.totalTrades
        });
    } catch (error) {
        console.error('Force resync error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL TRADE CONTROLS — Dashboard Edit Panel
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/trades/:id/close — Force close a trade immediately
router.post('/trades/:id/close', (req, res) => {
    const { id } = req.params;
    const trade = botState.activeTrades.find(t => t.id === id);
    if (!trade) return res.status(404).json({ error: 'Trade non trouvé' });

    trade._manualClose = true;
    trade._manualCloseReason = '🖐️ Fermeture manuelle via Dashboard';
    stateManager.save();
    addLog(botState, `🖐️ Fermeture manuelle déclenchée: ${(trade.question || '').substring(0, 40)}...`, 'warning');
    res.json({ success: true, message: 'Trade marqué pour fermeture au prochain cycle (~60s)' });
});

// PATCH /api/trades/:id/resize — Change position size
router.patch('/trades/:id/resize', (req, res) => {
    const { id } = req.params;
    const { newSize } = req.body;

    const idx = botState.activeTrades.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Trade non trouvé' });
    const trade = botState.activeTrades[idx];

    const newSizeNum = parseFloat(newSize);
    if (isNaN(newSizeNum) || newSizeNum <= 0) {
        return res.status(400).json({ error: 'Montant invalide (doit être > 0)' });
    }

    const delta = newSizeNum - (trade.amount || 0);

    if (Math.abs(delta) < 0.01) {
        return res.json({ success: true, message: 'Aucun changement (même montant)' });
    }

    // Use latest known price (last in priceHistory, or entryPrice as fallback)
    const currentPrice = (trade.priceHistory && trade.priceHistory.length > 0)
        ? trade.priceHistory[trade.priceHistory.length - 1]
        : (trade.entryPrice || 0.5);

    if (delta > 0) {
        // Increasing — check capital availability
        if (delta > botState.capital) {
            return res.status(400).json({ error: `Capital insuffisant — disponible: $${botState.capital.toFixed(2)}` });
        }
        const maxPos = botState.capital * (CONFIG.MAX_POSITION_PCT || 0.20);
        if (newSizeNum > (trade.amount || 0) + maxPos) {
            return res.status(400).json({ error: `Dépasse le max autorisé par position ($${maxPos.toFixed(0)})` });
        }
        // Buy more shares at current price
        trade.shares += delta / currentPrice;
        trade.amount = newSizeNum;
        botState.capital -= delta;
        addLog(botState, `📈 Position agrandie: ${(trade.question || '').substring(0, 30)}... +$${delta.toFixed(0)} → total $${trade.amount.toFixed(0)}`, 'info');

    } else {
        // Decreasing — partial close
        const reduceAmt = Math.abs(delta);
        const ratio = reduceAmt / (trade.amount || 1);
        const sharesToSell = trade.shares * ratio;
        const proceeds = sharesToSell * currentPrice;

        trade.shares -= sharesToSell;
        trade.amount = newSizeNum;
        botState.capital += proceeds;
        addLog(botState, `📉 Position réduite: ${(trade.question || '').substring(0, 30)}... -$${reduceAmt.toFixed(0)} → total $${trade.amount.toFixed(0)}`, 'info');
    }

    stateManager.save();
    res.json({
        success: true,
        trade: { id: trade.id, amount: trade.amount, shares: trade.shares },
        capitalRemaining: botState.capital
    });
});

// PATCH /api/trades/:id/sl — Set a custom stop-loss override
router.patch('/trades/:id/sl', (req, res) => {
    const { id } = req.params;
    const { stopLossPct } = req.body; // positive number, e.g. 12 = -12%

    const trade = botState.activeTrades.find(t => t.id === id);
    if (!trade) return res.status(404).json({ error: 'Trade non trouvé' });

    const pct = parseFloat(stopLossPct);
    if (isNaN(pct) || pct <= 0 || pct > 50) {
        return res.status(400).json({ error: 'Stop-loss invalide — entrer une valeur entre 1 et 50 (%)' });
    }

    trade.manualSL = pct;
    stateManager.save();
    addLog(botState, `🛡️ Stop-Loss manuel: ${(trade.question || '').substring(0, 30)}... → -${pct}%`, 'info');
    res.json({ success: true, manualSL: pct });
});

// PATCH /api/trades/:id/tp — Set a custom take-profit override
router.patch('/trades/:id/tp', (req, res) => {
    const { id } = req.params;
    const { takeProfitPct } = req.body; // positive number, e.g. 25 = +25%

    const trade = botState.activeTrades.find(t => t.id === id);
    if (!trade) return res.status(404).json({ error: 'Trade non trouvé' });

    const pct = parseFloat(takeProfitPct);
    if (isNaN(pct) || pct <= 0 || pct > 200) {
        return res.status(400).json({ error: 'Take-profit invalide — entrer une valeur entre 1 et 200 (%)' });
    }

    trade.manualTP = pct;
    stateManager.save();
    addLog(botState, `🎯 Take-Profit manuel: ${(trade.question || '').substring(0, 30)}... → +${pct}%`, 'info');
    res.json({ success: true, manualTP: pct });
});

export default router;
