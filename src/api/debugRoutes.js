import express from 'express';
import { screenshotService } from '../services/screenshotService.js';
import { CONFIG } from '../config.js';

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

export default router;
