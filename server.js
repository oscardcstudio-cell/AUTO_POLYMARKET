import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { simulationState } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API endpoint for dashboard to get bot status
app.get('/api/status', (req, res) => {
    res.json({
        bot_active: true,
        simulation_mode: true,
        last_update: simulationState.lastUpdate,
        trade_count: simulationState.tradeCount,
        trades: simulationState.activeTrades
    });
});

app.listen(PORT, () => {
    console.log(`Dashboard available at http://localhost:${PORT}`);
});
