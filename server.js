
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
    getRelevantMarkets
} from './src/logic/signals.js';
import { getPizzaData } from './src/api/pizzint.js';
import { getEventSlug } from './src/api/market_discovery.js';
import { getMidPrice } from './src/api/clob_api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- EXPRESS SERVER ---
const app = express();

// Serve static files (Dashboard)
app.use(express.static(__dirname));
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot_dashboard.html'));
});

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
            // checkConnectivity(); // (Optional, implemented in signals implicitly via 'apiStatus' updates)

            // 2. Fetch Intelligence (PizzInt / Alpha)
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
            // Inject Real Price Fetcher logic
            await checkAndCloseTrades(async (trade) => {
                try {
                    // 1. Try CLOB if Token IDs are available
                    if (trade.clobTokenIds && trade.clobTokenIds.length === 2) {
                        // Assumption: clobTokenIds[0] = YES, [1] = NO. 
                        // Gamma uses [YES, NO] order for outcomePrices usually.
                        const tokenId = trade.side === 'YES' ? trade.clobTokenIds[0] : trade.clobTokenIds[1];
                        if (tokenId) {
                            const clobPrice = await getMidPrice(tokenId);
                            if (clobPrice) return clobPrice;
                        }
                    }

                    // 2. If no CLOB, return null (Skip processing)
                    // User requested NO MOCK DATA.
                    return null;
                } catch (e) { return null; }
            });

            // 4. Market Scanning
            await scanArbitrage();
            await detectWizards();
            await detectWhales();
            await detectFreshMarkets();

            // 5. Signal Update (Periodic)
            if (botState.capitalHistory.length % 10 === 0) {
                await updateTopSignal(pizzaData);
            }

            // 6. TRADING EXECUTION
            // A. Fresh Markets (Priority)
            if (botState.freshMarkets.length > 0 && pizzaData && botState.capital >= CONFIG.MIN_TRADE_SIZE) {
                const freshCount = botState.activeTrades.filter(t => t.isFresh).length;
                if (freshCount < 2 && botState.activeTrades.length < 7) {
                    const freshMarket = botState.freshMarkets[0];
                    const alreadyTraded = botState.activeTrades.some(t => t.marketId === freshMarket.id);

                    if (!alreadyTraded) {
                        const trade = simulateTrade(freshMarket, pizzaData, true);
                        if (trade) {
                            addLog(botState, `🚀 Fresh trade: ${trade.question.substring(0, 30)}...`, 'success');
                            // Async slug fetch
                            getEventSlug(trade.marketId, trade.question).then(s => {
                                if (s) { trade.eventSlug = s; stateManager.save(); }
                            });
                        }
                    }
                }
            }

            // B. Standard Trading
            if (pizzaData && botState.capital >= CONFIG.MIN_TRADE_SIZE) {
                if (botState.activeTrades.length < CONFIG.MAX_ACTIVE_TRADES) {
                    const markets = await getRelevantMarkets();
                    if (markets.length > 0) {
                        // Random Pick from top 15 to avoid always picking #1
                        const market = markets[Math.floor(Math.random() * Math.min(15, markets.length))];
                        const alreadyTraded = botState.activeTrades.some(t => t.marketId === market.id);

                        if (!alreadyTraded) {
                            const trade = simulateTrade(market, pizzaData);
                            if (trade) {
                                getEventSlug(trade.marketId, trade.question).then(s => {
                                    if (s) { trade.eventSlug = s; stateManager.save(); }
                                });
                            }
                        }
                    }
                }
            }

            // 7. Data Sync
            // Record capital history occasionally
            if (Math.random() < 0.1) {
                botState.capitalHistory.push({
                    t: new Date().toISOString(),
                    v: botState.capital
                });
                if (botState.capitalHistory.length > 100) botState.capitalHistory.shift();

                // Trigger Git Sync occasionally
                saveToGithub();
            }

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
