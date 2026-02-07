
import express from 'express';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';

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

    res.json({ success: true, message: "Simulation reset successful" });
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

export default router;
