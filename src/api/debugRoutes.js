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

export default router;
