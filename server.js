
// --- AUTO-POLYMARKET BOT v2.5 (Modular) ---
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './src/config.js';
import { stateManager, botState } from './src/state.js';
import { addLog, saveToGithub } from './src/utils.js';
import apiRoutes from './src/routes/api.js';
import analyticsRoutes from './src/api/analyticsRoutes.js';
import debugRoutes from './src/api/debugRoutes.js';
import backtestRoutes from './src/api/backtestRoutes.js';
import { startPriceUpdateLoop } from './src/services/priceUpdateService.js';
import { startScheduler } from './src/cron/scheduler.js';

// Logic & Signals
import { simulateTrade, checkAndCloseTrades } from './src/logic/engine.js';
import {
    detectWizards,
    detectWhales,
    detectCopySignals,
    scanArbitrage,
    detectFreshMarkets,
    updateTopSignal,
    fetchNewsSentiment,
    checkConnectivity,
    getRelevantMarkets,
    categorizeMarket
} from './src/logic/signals.js';
import { getPizzaData } from './src/api/pizzint.js';
import { refreshTrackedWallets } from './src/api/wallet_tracker.js';
import { getEventSlug } from './src/api/market_discovery.js';
import { getMidPrice } from './src/api/clob_api.js';
import { feedbackLoop } from './src/logic/feedbackLoop.js';
import { supabaseService } from './src/services/supabaseService.js';
import { recordMarketBatch, buildCorrelationMap, detectCatalysts, evaluateDCA, executeDCA, getDrawdownRecoveryState, getCalendarSignal } from './src/logic/advancedStrategies.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- EXPRESS SERVER ---
const app = express();
app.use(express.json());

// Serve static files (Dashboard)
app.use(express.static(__dirname));
app.use('/api/debug', debugRoutes);

app.use('/api', backtestRoutes);
app.use('/api', apiRoutes);
app.use('/api/analytics', analyticsRoutes);

// Bot data API (used by analytics page and dashboard)
app.get('/api/bot-data', (req, res) => {
    res.json(botState);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot_dashboard.html'));
});

// Analytics Route
app.get('/analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'analytics.html'));
});

// Legacy Dashboard Redirect (Fixing "old page not updating" issue)
app.get('/dashboard.html', (req, res) => {
    res.redirect('/analytics');
});

// Helper logic for dynamic capacity (tension-aware)
function calculateMaxTrades(capital, pizzaData) {
    let base = CONFIG.BASE_MAX_TRADES || 10;

    // Capital bonus: +1 trade per $500 gained above starting $1000
    const profitBonus = Math.floor(Math.max(0, capital - 1000) / 500);
    base += profitBonus;

    // Tension-based capacity reduction (graduated, replaces binary DEFCON check)
    const tension = pizzaData?.tensionScore || 0;
    const T = CONFIG.TENSION || {};
    if (tension >= (T.CRITICAL || 80)) {
        base = Math.max(5, Math.floor(base * (T.CAPACITY_MULT_CRITICAL || 0.5)));
    } else if (tension >= (T.HIGH || 55)) {
        base = Math.max(5, Math.floor(base * (T.CAPACITY_MULT_HIGH || 0.75)));
    }

    // Safety Cap
    return Math.min(base, 25);
}

// Start Server
app.listen(CONFIG.PORT, () => {
    console.log(`\n🚀 SERVER STARTED ON PORT ${CONFIG.PORT}`);
    console.log(`📅 ${new Date().toLocaleString()}`);
    console.log(`✅ Version: 2.7.0 (Backtesting Overhaul + Wallet Reset)`);
    addLog(botState, `Serveur démarré sur le port ${CONFIG.PORT} (v2.7.0)`, 'success');
});

// --- MAIN LOOP ---
async function mainLoop() {
    addLog(botState, '🔄 Démarrage de la boucle de trading...', 'info');

    // 0. Disaster Recovery (Cloud Restore)
    try {
        await stateManager.tryRecovery();
    } catch (e) {
        console.error("Recovery failed:", e);
    }

    // Start Real-Time Price Tracking Service
    console.log('🔄 Starting real-time price tracking service...');
    startPriceUpdateLoop(botState);

    // Start AI Self-Training Scheduler
    startScheduler();

    // Initial wallet tracker refresh (leaderboard)
    try {
        await refreshTrackedWallets();
    } catch (e) {
        console.warn('Initial wallet tracker refresh failed:', e.message);
    }

    // State for Deep Scan
    let lastWalletRefresh = Date.now();
    let lastDeepScanTime = 0;
    const DEEP_SCAN_INTERVAL = 30 * 60 * 1000; // 30 minutes

    while (true) {
        try {
            // 1. Connectivity & API Status
            await checkConnectivity();

            // 2. Fetch Intelligence (PizzInt / Alpha)
            const now = Date.now();
            let relevantMarkets;
            let isDeepScan = false;

            if (now - lastDeepScanTime > DEEP_SCAN_INTERVAL) {
                addLog(botState, '🌊 LANCEMENT DEEP SCAN (1000+ marchés)...', 'info');
                relevantMarkets = await getRelevantMarkets(true); // DEEP SCAN
                lastDeepScanTime = now;
                isDeepScan = true;

                // Update stats & Cache for Marketplace
                botState.deepScanData = {
                    lastScan: new Date().toISOString(),
                    marketCount: relevantMarkets.length,
                    scanDuration: 0 // Could be measured
                };
                botState.marketCache = relevantMarkets; // Store for Frontend Marketplace
            } else {
                relevantMarkets = await getRelevantMarkets(false); // QUICK SCAN
            }

            if (!relevantMarkets || relevantMarkets.length === 0) {
                addLog(botState, '⚠️ Aucun marché trouvé, nouvelle tentative...', 'warning');
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            try {
                await fetchNewsSentiment();
                botState.apiStatus.alpha = 'ONLINE';
            } catch (e) { botState.apiStatus.alpha = 'OFFLINE'; }

            const pizzaData = await getPizzaData();
            if (pizzaData) {
                botState.lastPizzaData = pizzaData;
                botState.apiStatus.pizzint = 'ONLINE';
                // Log tension on first fetch or significant changes
                const prevTension = botState._lastLoggedTension || 0;
                if (Math.abs(pizzaData.tensionScore - prevTension) >= 10 || !botState._lastLoggedTension) {
                    addLog(botState, `PizzINT: DEFCON ${pizzaData.defcon} | Tension ${pizzaData.tensionScore}/100 (${pizzaData.tensionTrend}) | Spikes: ${pizzaData.spikes?.active || 0}`, 'info');
                    botState._lastLoggedTension = pizzaData.tensionScore;
                }
            } else {
                botState.apiStatus.pizzint = 'OFFLINE';
            }

            // 3. Portfolio Management
            // Inject Real Price Fetcher (CLOB with Gamma Fallback)
            await checkAndCloseTrades(async (trade) => {
                try {
                    // a) Try CLOB first — parse clobTokenIds if it's a JSON string
                    let tokenIds = trade.clobTokenIds;
                    if (typeof tokenIds === 'string') {
                        try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = null; }
                    }
                    if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
                        const tokenId = trade.side === 'YES' ? tokenIds[0] : tokenIds[1];
                        if (tokenId && typeof tokenId === 'string' && tokenId.length > 10) {
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
            await scanArbitrage(relevantMarkets);
            await detectWizards(relevantMarkets);
            await detectWhales(relevantMarkets);
            await detectCopySignals(relevantMarkets);
            await detectFreshMarkets();

            // 4b. Copy Trading: Refresh leaderboard every 6h
            if (isDeepScan) {
                const walletRefreshInterval = CONFIG.COPY_TRADING?.LEADERBOARD_CACHE_TTL_MS || 6 * 60 * 60 * 1000;
                if (Date.now() - lastWalletRefresh > walletRefreshInterval) {
                    try {
                        await refreshTrackedWallets();
                        lastWalletRefresh = Date.now();
                    } catch (e) {
                        console.warn('Wallet tracker refresh failed:', e.message);
                    }
                }
            }

            // 4c. Advanced Strategies: Market Memory + Catalysts + Correlations
            try {
                recordMarketBatch(relevantMarkets);
                detectCatalysts(pizzaData, relevantMarkets);
                // Rebuild correlation map every deep scan
                if (isDeepScan) {
                    botState._correlationMap = buildCorrelationMap(relevantMarkets);
                }
            } catch (e) {
                console.warn('Advanced strategies update error:', e.message);
            }

            // 4c. Strategy Status Log (every deep scan = every 30 min)
            if (isDeepScan) {
                try {
                    const recovery = getDrawdownRecoveryState();
                    const calendar = getCalendarSignal();
                    const activeCategories = [...new Set(botState.activeTrades.map(t => t.category))];
                    const yesCount = botState.activeTrades.filter(t => t.side === 'YES').length;
                    const noCount = botState.activeTrades.filter(t => t.side === 'NO').length;

                    let statusParts = [];
                    // Anti-Fragility tier
                    if (recovery.tier > 0) {
                        statusParts.push(`🛡️ Anti-Fragility Tier ${recovery.tier} (size x${recovery.sizeMultiplier})`);
                    } else {
                        statusParts.push('🟢 Normal mode');
                    }
                    // Calendar
                    if (calendar.signals.length > 0) {
                        statusParts.push(calendar.signals[0]);
                    }
                    // Portfolio balance
                    statusParts.push(`Portfolio: ${yesCount}Y/${noCount}N across ${activeCategories.length} categories`);

                    addLog(botState, `📊 Strategy Status: ${statusParts.join(' | ')}`, 'info');
                } catch (e) {
                    // Non-critical — don't crash the loop
                }
            }

            // 5. Signal Update (Periodic)
            if (botState.capitalHistory.length % 5 === 0) {
                await updateTopSignal(pizzaData);
                // Run AI Feedback Analysis
                if (botState.capitalHistory.length % 20 === 0) { // Less frequent
                    await feedbackLoop.analyzePerformance();
                    await feedbackLoop.runAutonomousBacktest();
                }
            }

            // 6. DYNAMIC CAPACITY & SCANNING
            const maxTrades = calculateMaxTrades(botState.capital, pizzaData);
            const isFull = botState.activeTrades.length >= maxTrades;

            if (isFull) {
                console.log(`📊 Portefeuille plein (${botState.activeTrades.length}/${maxTrades}). Mode observation.`);
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

                // 2b. Copy Trade Signals (top leaderboard wallets)
                if (botState.lastCopySignals) {
                    for (const sig of botState.lastCopySignals) {
                        const m = relevantMarkets.find(x =>
                            (x.conditionID || x.conditionId) === sig.position.conditionId ||
                            x.slug === sig.position.slug
                        );
                        if (m) candidates.push({ market: m, isFresh: false, priority: 'COPY' });
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

                // 6b. DCA: Check if any active trades deserve an add-on
                if (!tradeExecutedThisLoop && botState.capital >= CONFIG.MIN_TRADE_SIZE) {
                    try {
                        for (const trade of botState.activeTrades) {
                            const dca = evaluateDCA(trade.marketId);
                            if (dca.shouldDCA && dca.existingTrade) {
                                const currentPrice = dca.existingTrade.priceHistory?.length > 0
                                    ? dca.existingTrade.priceHistory[dca.existingTrade.priceHistory.length - 1]
                                    : null;
                                if (currentPrice) {
                                    const result = executeDCA(dca.existingTrade, currentPrice);
                                    if (result) {
                                        tradeExecutedThisLoop = true;
                                        await supabaseService.saveTrade(dca.existingTrade).catch(e => console.error('DCA Supabase:', e));
                                        break; // 1 DCA per loop
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('DCA check error:', e.message);
                    }
                }

                // 7. Loop Summary & Observational Logging (Always Visible)
                if (!tradeExecutedThisLoop && uniqueCandidates.length > 0) {
                    const uniqueReasons = [...new Set(rejectionReasons)].slice(0, 3);
                    const reasonSummary = uniqueReasons.length > 0 ? " | " + uniqueReasons.join(", ") : "";
                    const prefix = isFull ? "👁️ OBS" : "🔍 Scan";
                    addLog(botState, `${prefix}: ${uniqueCandidates.length} marchés analysés, aucun trade${reasonSummary}`, 'info');

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

            // Heartbeat for Health Check
            botState.lastHeartbeat = new Date().toISOString();

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
