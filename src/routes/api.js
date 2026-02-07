
import express from 'express';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';
import { simulateTrade } from '../logic/engine.js';
import { getRelevantMarkets } from '../logic/signals.js';

const router = express.Router();

// --- API ENDPOINTS ---

router.get('/bot-data', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Derived stats for dashboard
    const profit = botState.capital - botState.startingCapital;
    const profitPercent = ((profit) / botState.startingCapital * 100).toFixed(2);

    const data = {
        ...botState,
        profit,
        profitPercent
    };
    res.json(data);
});

// Endpoint pour réinitialiser la simulation
router.post('/reset', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Resetting State via Manager manually
    // We could add a reset() method to StateManager but this works too
    Object.assign(botState, {
        startTime: new Date().toISOString(),
        capital: CONFIG.STARTING_CAPITAL,
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
        freshMarkets: []
    });

    addLog(botState, '♻️ SIMULATION RESET: Portefeuille réinitialisé à $1000', 'warning');
    stateManager.save();

    // Trigger Automated Test Trade ($1)
    getRelevantMarkets().then(markets => {
        if (markets.length > 0) {
            const m = markets[Math.floor(Math.random() * markets.length)];
            addLog(botState, `🛠️ Triggering forced test trade on: ${m.question.substring(0, 30)}...`, 'info');
            simulateTrade(m, null, false, { testSize: 1.0, isTest: true })
                .then(t => {
                    if (t) addLog(botState, `✅ Test trade SUCCESS`, 'success');
                    else addLog(botState, `❌ Test trade FAILED to open`, 'error');
                })
                .catch(e => addLog(botState, `❌ Test trade ERROR: ${e.message}`, 'error'));
        } else {
            addLog(botState, `⚠️ No relevant markets for test trade`, 'warning');
        }
    });

    res.json({ success: true, message: "Simulation reset successful + Test trade triggered" });
});

// Health check endpoint pour Railway
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        capital: botState.capital,
        activeTrades: botState.activeTrades.length
    });
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

export default router;
