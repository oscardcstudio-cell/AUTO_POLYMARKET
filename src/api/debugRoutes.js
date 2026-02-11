import express from 'express';
import { screenshotService } from '../services/screenshotService.js';
import { CONFIG } from '../config.js';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Middleware to check for simple admin key query param
const checkAdminKey = (req, res, next) => {
    // Basic protection: ?key=... (You can set ADMIN_KEY in .env)
    const key = req.query.key;
    const requiredKey = process.env.ADMIN_KEY || 'debug123';

    if (key !== requiredKey) {
        return res.status(403).json({ error: 'Unauthorized: Invalid key' });
    }
    next();
};

router.get('/ping', (req, res) => {
    res.send('pong');
});

/**
 * GET /api/debug/screenshot
 * Params:
 *  - view: 'dashboard' | 'marketplace' | 'logs' (default: dashboard)
 *  - key: Admin Key
 */
router.get('/screenshot', checkAdminKey, async (req, res) => {
    try {
        const view = req.query.view || 'dashboard';
        console.log(`📸 Received screenshot request for view: ${view}`);

        const buffer = await screenshotService.capture(view);

        res.set('Content-Type', 'image/png');
        res.send(buffer);

    } catch (error) {
        console.error("DEBUG API Error:", error);
        res.status(500).json({ error: 'Screenshot failed', details: error.message });
    }
});

/**
 * GET /api/debug/logs
 * Read logs.txt from root
 */
router.get('/logs', checkAdminKey, (req, res) => {
    try {
        const logPath = path.join(process.cwd(), 'logs.txt');
        if (fs.existsSync(logPath)) {
            const logs = fs.readFileSync(logPath, 'utf8');
            // Return last 200 lines
            const lines = logs.split('\n').slice(-200).join('\n');
            res.setHeader('Content-Type', 'text/plain');
            res.send(lines);
        } else {
            res.send('No log file found.');
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to read logs', details: error.message });
    }
});

/**
 * POST /api/debug/log
 * Accept frontend debug logs and store in Supabase for remote diagnosis
 */
router.post('/log', async (req, res) => {
    try {
        const { source, level, data } = req.body;
        const logEntry = {
            source: source || 'frontend',
            level: level || 'debug',
            data: typeof data === 'string' ? data : JSON.stringify(data),
            timestamp: new Date().toISOString()
        };

        // Try to insert into Supabase
        try {
            const { supabase } = await import('../services/supabaseService.js');
            if (supabase) {
                await supabase.from('debug_logs').insert([logEntry]);
            }
        } catch (e) {
            // Supabase not available, just log to console
            console.log(`[DEBUG-LOG] ${logEntry.source}: ${logEntry.data}`);
        }

        res.json({ ok: true });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/debug/reset-bot
 * Trigger full bot reset (database + memory)
 * Uses the script functionality but via API
 */
router.post('/reset-bot', checkAdminKey, async (req, res) => {
    try {
        console.log("⚠️ RESET REQUESTED VIA DASHBOARD");

        const { supabase } = await import('../services/supabaseService.js');

        // 1. Reset Supabase
        if (supabase) {
            await supabase.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            await supabase.from('bot_state').delete().neq('id', 'placeholder');
            await supabase.from('active_trades').delete().neq('id', 'placeholder');
            // Keep logs or clear? Let's keep logs for diagnosis, but clear analytics
            console.log("✅ Supabase cleared.");
        }

        // 2. Reset Local State - we need to access StateManager
        const { stateManager } = await import('../state.js');
        const { CONFIG } = await import('../config.js');

        // Reset memory
        stateManager.data.capital = CONFIG.STARTING_CAPITAL || 1000;
        stateManager.data.activeTrades = [];
        stateManager.data.closedTrades = [];
        stateManager.data.totalTrades = 0;
        stateManager.data.winningTrades = 0;
        stateManager.data.losingTrades = 0;
        stateManager.data.profit = 0;
        stateManager.data.logs.unshift({
            timestamp: new Date().toISOString(),
            type: 'warning',
            message: '⚠️ BOT RESET VIA DASHBOARD'
        });

        // Save to disk
        stateManager.save();

        res.json({ ok: true, message: 'Bot reset successfully' });

    } catch (error) {
        console.error("Reset Error:", error);
        res.status(500).json({ error: 'Reset failed', details: error.message });
    }
});

export default router;
