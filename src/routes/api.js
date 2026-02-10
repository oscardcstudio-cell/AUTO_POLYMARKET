
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
router.post('/reset', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Resetting State via Manager manually
    // We could add a reset() method to StateManager but this works too
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
        wizards: [],
        freshMarkets: [],
        marketCache: []
    });

    addLog(botState, '♻️ SIMULATION RESET: Portefeuille réinitialisé à $1000', 'warning');

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

// Run Backtest Endpoint
// Run Backtest Endpoint
router.post('/run-backtest', async (req, res) => {
    try {
        const scriptPath = path.join(process.cwd(), 'scripts', 'backtest_public.js');

        exec(`node ${scriptPath}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Backtest error: ${error.message}`);
                return res.json({ success: false, error: error.message });
            }
            if (stderr) {
                console.error(`Backtest stderr: ${stderr}`);
            }

            // Parse stdout to find the JSON result or just return success
            // The script saves to Supabase, which is the source of truth for the frontend

            // We can try to parse the last line if it outputs JSON, but for now just return success
            // and let the frontend refresh the list from Supabase

            res.json({ success: true, message: 'Backtest completed successfully', output: stdout });
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

export default router;
