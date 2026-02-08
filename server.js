
// --- AUTO-POLYMARKET BOT v2.5 (Modular) ---
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './src/config.js';
import { stateManager, botState } from './src/state.js';
import { addLog, saveToGithub } from './src/utils.js';
import apiRoutes from './src/routes/api.js';

// Logic & Signals
import { simulateTrade, checkAndCloseTrades } from './src/logic/engine.js';
import {
    detectWizards,
    detectWhales,
    scanArbitrage,
    detectFreshMarkets,
    updateTopSignal,
    fetchNewsSentiment,
    checkConnectivity,
    getRelevantMarkets,
    categorizeMarket
} from './src/logic/signals.js';
import { getPizzaData } from './src/api/pizzint.js';
import { getEventSlug } from './src/api/market_discovery.js';
import { getMidPrice } from './src/api/clob_api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- EXPRESS SERVER ---
const app = express();
app.use(express.json());

// Serve static files (Dashboard)
app.use(express.static(__dirname));
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot_dashboard.html'));
});

// Helper logic for dynamic capacity
function calculateMaxTrades(capital, defcon = 5) {
    let base = CONFIG.BASE_MAX_TRADES || 10;

    // Capital bonus: +1 trade per $500 gained above starting $1000
    const profitBonus = Math.floor(Math.max(0, capital - 1000) / 500);
    base += profitBonus;

    // Crisis modifier: Reduce capacity during DEFCON 1-2 to avoid spreading too thin
    if (defcon <= 2) {
        base = Math.max(5, Math.floor(base * 0.5));
    }

    // Safety Cap
    return Math.min(base, 25);
}

// Start Server
app.listen(CONFIG.PORT, () => {
    console.log(`🤖 Bot Server running on port ${CONFIG.PORT}`);
    addLog(botState, `Serveur démarré sur le port ${CONFIG.PORT}`, 'success');
});

// --- MAIN LOOP ---
async function mainLoop() {
    addLog(botState, '🔄 Démarrage de la boucle de trading...', 'info');

    while (true) {
        try {
            // 1. Connectivity & API Status
            await checkConnectivity();

            // 2. Fetch Intelligence (PizzInt / Alpha)
            const relevantMarkets = await getRelevantMarkets();

            try {
                await fetchNewsSentiment();
                botState.apiStatus.alpha = 'ONLINE';
            } catch (e) { botState.apiStatus.alpha = 'OFFLINE'; }

            const pizzaData = await getPizzaData();
            if (pizzaData) {
                botState.lastPizzaData = pizzaData;
                botState.apiStatus.pizzint = 'ONLINE';
            } else {
                botState.apiStatus.pizzint = 'OFFLINE';
            }

            // 3. Portfolio Management
            // Inject Real Price Fetcher (CLOB with Gamma Fallback)
            await checkAndCloseTrades(async (trade) => {
                try {
                    // a) Try CLOB first
                    if (trade.clobTokenIds && trade.clobTokenIds.length === 2) {
                        const tokenId = trade.side === 'YES' ? trade.clobTokenIds[0] : trade.clobTokenIds[1];
                        if (tokenId) {
                            const clobPrice = await getMidPrice(tokenId);
                            if (clobPrice) return clobPrice;
                        }
                    }

                    // b) Fallback to Gamma (from our fresh fetch)
                    const market = relevantMarkets.find(m => m.id === trade.marketId);
                    if (market && market.outcomePrices) {
                        let prices = market.outcomePrices;
                        if (typeof prices === 'string') {
                            try { prices = JSON.parse(prices); } catch (e) { return null; }
                        }
                        const price = trade.side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
                        return isNaN(price) ? null : price;
                    }

                    return null;
                } catch (e) { return null; }
            });

            // 4. Market Scanning
            await scanArbitrage();
            await detectWizards();
            await detectWhales();
            await detectFreshMarkets();

            // 5. Signal Update (Periodic)
            if (botState.capitalHistory.length % 5 === 0) {
                await updateTopSignal(pizzaData);
            }

            // 6. DYNAMIC CAPACITY & SCANNING
            const maxTrades = calculateMaxTrades(botState.capital, pizzaData?.defcon);
            const isFull = botState.activeTrades.length >= maxTrades;

            if (isFull) {
                addLog(botState, `📊 Portefeuille plein (${botState.activeTrades.length}/${maxTrades}). Mode observation.`, 'info');
            }

            // Collect potential candidates ALWAYS (for logging)
            let candidates = [];
            if (relevantMarkets && relevantMarkets.length > 0) {
                // 1. Top Signal
                if (botState.topSignal) {
                    const m = relevantMarkets.find(x => x.id === botState.topSignal.id);
                    if (m) candidates.push({ market: m, isFresh: false, priority: 'TOP' });
                }

                // 2. Whale Alerts
                if (botState.whaleAlerts) {
                    for (const whale of botState.whaleAlerts) {
                        const m = relevantMarkets.find(x => x.id === whale.id);
                        if (m) candidates.push({ market: m, isFresh: false, priority: 'WHALE' });
                    }
                }

                // 3. Wizards
                if (botState.wizards) {
                    for (const wiz of botState.wizards) {
                        const m = relevantMarkets.find(x => x.id === wiz.id);
                        if (m) candidates.push({ market: m, isFresh: false, priority: 'WIZARD' });
                    }
                }

                // 4. Fresh Markets
                botState.freshMarkets.forEach(m => candidates.push({ market: m, isFresh: true, priority: 'FRESH' }));

                // 5. Standard Markets (Top 10)
                relevantMarkets.slice(0, 10).forEach(m => candidates.push({ market: m, isFresh: false, priority: 'STD' }));

                // Deduplicate candidates by ID
                const seenIds = new Set();
                const uniqueCandidates = [];
                for (const c of candidates) {
                    if (!seenIds.has(c.market.id)) {
                        seenIds.add(c.market.id);
                        uniqueCandidates.push(c);
                    }
                }

                // Try to execute (Only if not full and has capital)
                let tradeExecutedThisLoop = false;
                const rejectionReasons = [];

                if (!isFull && botState.capital >= CONFIG.MIN_TRADE_SIZE) {
                    for (const candidate of uniqueCandidates) {
                        if (botState.activeTrades.length >= maxTrades) break;
                        if (botState.capital < CONFIG.MIN_TRADE_SIZE) break;

                        const alreadyTraded = botState.activeTrades.some(t => t.marketId === candidate.market.id);
                        if (alreadyTraded) continue;

                        const marketReasons = [];
                        let result = await simulateTrade(candidate.market, pizzaData, candidate.isFresh, { reasonsCollector: marketReasons });

                        if (result) {
                            tradeExecutedThisLoop = true;
                            const tradesToProcess = Array.isArray(result) ? result : [result];

                            for (const t of tradesToProcess) {
                                addLog(botState, `🚀 [${candidate.priority}] Trade: ${t.question.substring(0, 30)}...`, 'success');
                                getEventSlug(t.marketId, t.question).then(s => {
                                    if (s) { t.eventSlug = s; stateManager.save(); }
                                });
                            }
                            break; // Limit to 1 trade group per loop for stability
                        } else {
                            if (marketReasons.length > 0) {
                                rejectionReasons.push(`${candidate.priority}: ${marketReasons[marketReasons.length - 1]}`);
                            }
                        }
                    }
                }

                // 7. Loop Summary & Observational Logging (Always Visible)
                if (!tradeExecutedThisLoop && uniqueCandidates.length > 0) {
                    const uniqueReasons = [...new Set(rejectionReasons)].slice(0, 3);
                    const reasonSummary = uniqueReasons.length > 0 ? " | " + uniqueReasons.join(", ") : "";
                    const prefix = isFull ? "👁️ OBS: " : "🔍 ";
                    addLog(botState, `${prefix}Scanned ${uniqueCandidates.length} markets. No entry found${reasonSummary}`, 'info');

                    // Add observational pulses for surveillance visibility
                    const sectorsFound = [...new Set(uniqueCandidates.map(c => c.market._category || categorizeMarket(c.market.question)))];
                    sectorsFound.forEach(sec => {
                        stateManager.addSectorEvent(sec, 'ANALYSIS', `Observation: ${uniqueCandidates.filter(c => (c.market._category || categorizeMarket(c.market.question)) === sec).length} marchés scannés.`, { status: 'idle' });
                    });
                }
            }

            // 7. Data Sync
            // Record capital history
            botState.capitalHistory.push({
                t: new Date().toISOString(),
                v: botState.capital
            });
            if (botState.capitalHistory.length > 100) botState.capitalHistory.shift();

            // Trigger Git Sync occasionally
            saveToGithub();

            stateManager.save();

        } catch (error) {
            console.error('❌ Main Loop Error:', error);
            addLog(botState, `Main Loop Error: ${error.message}`, 'error');
        }

        // Wait for next poll
        await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MINUTES * 60 * 1000));
    }
}

// Start Loop
mainLoop();
