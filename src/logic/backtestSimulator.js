
import { simulateTrade } from './engine.js';
import { botState } from '../state.js';
import { CONFIG } from '../config.js';
import {
    recordMarketSnapshot,
    buildCorrelationMap,
    detectCatalysts,
    clearMarketMemory,
    clearEventCatalysts
} from './advancedStrategies.js';
import { categorizeMarket } from './signals.js';

// REALISTIC COSTS
const DEFAULT_SLIPPAGE = 0.015;
const POLYMARKET_FEES = 0.02;

/**
 * Estimate slippage based on market liquidity (Phase 5).
 * High volume/liquidity = tight spread, low = wide spread.
 */
function estimateSlippage(market) {
    const tiers = CONFIG.BACKTEST?.SLIPPAGE_TIERS;
    if (!tiers) return DEFAULT_SLIPPAGE;

    const volume = parseFloat(market.volume24hr || 0);
    const liquidity = parseFloat(market.liquidityNum || 0);

    if (volume > tiers.HIGH_LIQUIDITY.minVolume || liquidity > tiers.HIGH_LIQUIDITY.minLiquidity) {
        return tiers.HIGH_LIQUIDITY.slippage; // 0.3%
    }
    if (volume > tiers.MEDIUM.minVolume || liquidity > tiers.MEDIUM.minLiquidity) {
        return tiers.MEDIUM.slippage; // 1.5%
    }
    return tiers.LOW.slippage; // 3%
}

// Rate limiting for CLOB API
const CLOB_DELAY_MS = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch historical price data from Polymarket CLOB API.
 * Returns array of {t, p} sorted by time, or null on failure.
 */
async function fetchHistoricalPrices(clobTokenId) {
    if (!clobTokenId) return null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const url = `https://clob.polymarket.com/prices-history?market=${clobTokenId}&interval=max&fidelity=60`;
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const data = await response.json();
        if (!data?.history || !Array.isArray(data.history) || data.history.length < 5) return null;

        return data.history
            .map(point => ({ t: point.t, p: parseFloat(point.p) }))
            .filter(point => !isNaN(point.p) && point.p > 0 && point.p < 1)
            .sort((a, b) => a.t - b.t);
    } catch {
        return null;
    }
}

/**
 * Pick a realistic entry price from historical data.
 * Selects from the middle 50% of the timeline (not too early, not near resolution).
 */
function pickEntryFromHistory(priceHistory, actualWinner) {
    const len = priceHistory.length;
    const start = Math.floor(len * 0.25);
    const end = Math.floor(len * 0.75);
    const idx = start + Math.floor(Math.random() * (end - start));
    return priceHistory[idx].p;
}

/**
 * Generate a weighted DEFCON value (1-5).
 * Distribution: 1 (5%), 2 (10%), 3 (35%), 4 (30%), 5 (20%)
 */
function generateWeightedDEFCON() {
    const r = Math.random();
    if (r < 0.05) return 1;
    if (r < 0.15) return 2;
    if (r < 0.50) return 3;
    if (r < 0.80) return 4;
    return 5;
}

/**
 * Generate realistic simulated PizzINT tension data correlated to DEFCON.
 * Returns full pizza data object compatible with the new enriched format.
 */
function generateSimulatedTensionData(defcon) {
    let baseTension;
    if (defcon <= 2) baseTension = 60 + Math.floor(Math.random() * 35);
    else if (defcon === 3) baseTension = 25 + Math.floor(Math.random() * 30);
    else baseTension = Math.floor(Math.random() * 30);

    const sustained = defcon <= 2 ? Math.random() > 0.5 : false;
    const sentinel = defcon === 1 ? Math.random() > 0.7 : false;

    return {
        index: baseTension,
        defcon,
        trends: [],
        tensionScore: baseTension,
        tensionTrend: Math.random() > 0.6 ? 'RISING' : (Math.random() > 0.5 ? 'STABLE' : 'FALLING'),
        defconDetails: {
            severity: defcon <= 2 ? 3 + Math.random() * 2 : Math.random() * 2,
            rawIndex: baseTension,
            smoothedIndex: baseTension,
            intensityScore: baseTension / 100,
            breadthScore: Math.random() * 0.5,
            nightMultiplier: 1,
            persistenceFactor: sustained ? 1.5 : 1,
            sustained,
            sentinel,
            placesAbove150: defcon <= 2 ? Math.floor(Math.random() * 5) : 0,
            placesAbove200: defcon <= 1 ? Math.floor(Math.random() * 3) : 0,
            highCount: defcon <= 2 ? Math.floor(Math.random() * 3) : 0,
            extremeCount: defcon <= 1 ? Math.floor(Math.random() * 2) : 0,
            maxPct: 0,
        },
        spikes: {
            active: defcon <= 3 ? Math.floor(Math.random() * 3) : 0,
            hasActive: defcon <= 3,
            events: [],
        },
        venues: [],
        dataFreshness: 'simulated',
        history: [],
    };
}

/**
 * Fetch real resolved markets from Polymarket's public API.
 * Fetches multiple pages for a larger sample (Fix C).
 * Attempts to get historical prices for each market (Fix A).
 */
async function fetchResolvedMarkets(log) {
    try {
        log('Fetching resolved markets (3 pages)...');
        const allEvents = [];

        // Fetch 3 pages of 50 for a larger pool
        for (const offset of [0, 50, 100]) {
            try {
                const url = `https://gamma-api.polymarket.com/events?closed=true&limit=50&offset=${offset}&order=volume24hr&ascending=false`;
                const response = await fetch(url);
                if (!response.ok) continue;
                const events = await response.json();
                allEvents.push(...events);
            } catch {
                // Skip failed pages
            }
        }

        if (allEvents.length === 0) return [];

        const resolvedMarkets = [];

        for (const event of allEvents) {
            if (!event.markets || event.markets.length === 0) continue;

            for (const market of event.markets) {
                if (!market.outcomePrices) continue;

                let prices;
                try {
                    prices = typeof market.outcomePrices === 'string'
                        ? JSON.parse(market.outcomePrices)
                        : market.outcomePrices;
                } catch { continue; }

                if (!Array.isArray(prices) || prices.length < 2) continue;

                const yesPrice = parseFloat(prices[0]);
                const noPrice = parseFloat(prices[1]);

                let actualWinner = null;
                if (yesPrice > 0.95) actualWinner = 'YES';
                else if (noPrice > 0.95) actualWinner = 'NO';
                else continue;

                const preResolutionSnapshot = {
                    ...market,
                    outcomePrices: market.outcomePrices,
                    _isBacktestMarket: true
                };

                const volume = parseFloat(market.volume || market.volumeNum || 0);
                const liquidity = parseFloat(market.liquidityNum || 0);

                preResolutionSnapshot.volume24hr = volume || Math.random() * 50000;
                preResolutionSnapshot.liquidityNum = liquidity || Math.random() * 10000;

                resolvedMarkets.push({
                    market: preResolutionSnapshot,
                    actualWinner,
                    originalQuestion: market.question,
                    _priceHistory: null // Will be populated below
                });
            }
        }

        // Fetch historical prices for each market (rate limited)
        let historicalCount = 0;
        let fallbackCount = 0;

        for (const entry of resolvedMarkets) {
            let tokenIds = entry.market.clobTokenIds;
            if (typeof tokenIds === 'string') {
                try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = null; }
            }
            const tokenId = Array.isArray(tokenIds) && tokenIds.length >= 1 && typeof tokenIds[0] === 'string' && tokenIds[0].length > 10
                ? tokenIds[0] : null;

            if (tokenId) {
                const history = await fetchHistoricalPrices(tokenId);
                if (history && history.length >= 10) {
                    entry._priceHistory = history;

                    // Use a real historical price as the entry price
                    const simYesPrice = pickEntryFromHistory(history, entry.actualWinner);
                    entry.market.outcomePrices = [
                        simYesPrice.toFixed(4),
                        (1 - simYesPrice).toFixed(4)
                    ];
                    historicalCount++;
                    await sleep(CLOB_DELAY_MS);
                    continue;
                }
                await sleep(CLOB_DELAY_MS);
            }

            // Fallback: synthetic price (old behavior)
            let simYesPrice, simNoPrice;
            if (entry.actualWinner === 'YES') {
                simYesPrice = 0.40 + Math.random() * 0.40;
                simNoPrice = 1 - simYesPrice;
            } else {
                simNoPrice = 0.40 + Math.random() * 0.40;
                simYesPrice = 1 - simNoPrice;
            }
            entry.market.outcomePrices = [
                simYesPrice.toFixed(4),
                simNoPrice.toFixed(4)
            ];
            fallbackCount++;
        }

        log(`Prices: ${historicalCount} historical, ${fallbackCount} synthetic fallback`);
        return resolvedMarkets;
    } catch (error) {
        console.error('Failed to fetch resolved markets:', error.message);
        return [];
    }
}

/**
 * Generate a synthetic price path using geometric Brownian motion.
 * Drift is toward the actual resolution outcome.
 */
function generateSyntheticPricePath(entryPrice, actualWinner, betSide, category, steps) {
    const vol = CONFIG.BACKTEST?.SYNTHETIC_VOLATILITY?.[category] || 0.015;
    const points = [];
    let price = entryPrice;

    // Drift toward resolution: if YES wins, price drifts toward 1.0
    const targetPrice = actualWinner === 'YES' ? 0.95 : 0.05;
    const drift = (targetPrice - entryPrice) / (steps * 2); // Slow drift

    for (let i = 0; i < steps; i++) {
        const noise = (Math.random() - 0.5) * 2 * vol;
        price = price + drift + noise;
        price = Math.max(0.02, Math.min(0.98, price)); // Clamp
        points.push(price);
    }

    return points;
}

/**
 * Simulate the exit path for a trade using price history.
 * Replicates the real bot's SL/TP/trailing/timeout logic from engine.js.
 *
 * Returns: { pnl, exitPrice, exitType, exitStep }
 *   exitType: 'STOP_LOSS' | 'TRAILING_STOP' | 'TAKE_PROFIT' | 'TIMEOUT' | 'MAX_LOSS_CAP' | 'RESOLUTION'
 */
function simulateExitPath(betAmount, betPrice, betSide, actualWinner, category, priceHistory, entryIdx, slippage = DEFAULT_SLIPPAGE) {
    const shares = betAmount / betPrice;
    const slippageCost = betAmount * slippage;
    const fees = betAmount * POLYMARKET_FEES;

    // Get the price points after entry
    let pricePath;
    if (priceHistory && priceHistory.length > 0 && entryIdx !== undefined) {
        // Use real CLOB prices after entry point
        pricePath = priceHistory.slice(entryIdx).map(p => typeof p === 'object' ? p.p : p);
    } else {
        // Generate synthetic path
        const steps = CONFIG.BACKTEST?.SYNTHETIC_WALK_POINTS || 80;
        pricePath = generateSyntheticPricePath(betPrice, actualWinner, betSide, category, steps);
    }

    if (!pricePath || pricePath.length < 3) {
        // Fallback to instant resolution
        const pnl = calculateRealPnL(betAmount, betPrice, actualWinner, betSide, slippage);
        return { pnl, exitPrice: betSide === actualWinner ? 1.0 : 0.0, exitType: 'RESOLUTION', exitStep: 0 };
    }

    // SL config
    const volatilityMap = CONFIG.DYNAMIC_SL?.VOLATILITY_MAP || {};
    let baseStopPercent = volatilityMap[category] || volatilityMap.other || 0.15;
    if (betPrice < 0.35 && CONFIG.DYNAMIC_SL?.SPECULATIVE_SL_OVERRIDE) {
        baseStopPercent = Math.min(baseStopPercent, CONFIG.DYNAMIC_SL.SPECULATIVE_SL_OVERRIDE);
    }
    const stopLossLevel = -baseStopPercent;
    const maxLossCap = -0.15; // From data-driven tuning

    // TP config — use category-based volatility to pick TP tier
    const smartExit = CONFIG.SMART_EXIT || {};
    const tpMap = smartExit.TP_MAP || { LOW: 0.15, MEDIUM: 0.20, HIGH: 0.30 };
    // Estimate volatility from price path
    let priceStdDev = 0;
    if (pricePath.length > 3) {
        const changes = [];
        for (let i = 1; i < Math.min(pricePath.length, 20); i++) {
            if (pricePath[i - 1] > 0) changes.push((pricePath[i] - pricePath[i - 1]) / pricePath[i - 1]);
        }
        if (changes.length > 0) {
            const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
            priceStdDev = Math.sqrt(changes.reduce((s, c) => s + (c - mean) ** 2, 0) / changes.length);
        }
    }
    const volThresholds = smartExit.VOLATILITY_THRESHOLDS || { LOW: 0.02, HIGH: 0.05 };
    let tpPercent = priceStdDev < volThresholds.LOW ? tpMap.LOW
        : priceStdDev > volThresholds.HIGH ? tpMap.HIGH
        : tpMap.MEDIUM;

    // Trailing config
    const trailingActivation = CONFIG.DYNAMIC_SL?.TRAILING_ACTIVATION || 0.10;
    const trailingDistance = CONFIG.DYNAMIC_SL?.TRAILING_DISTANCE || 0.05;
    const timeoutSteps = CONFIG.BACKTEST?.TIMEOUT_STEPS || 48;
    const partialExitRatio = smartExit.PARTIAL_EXIT_RATIO || 0.5;

    let maxReturn = 0;
    let partialExitDone = false;
    let remainingShares = shares;
    let realizedPnl = 0;

    for (let step = 0; step < pricePath.length; step++) {
        const currentPrice = pricePath[step];

        // Calculate current return for the bet side
        // For YES bet: value = shares * currentPrice, for NO bet: value = shares * (1 - currentPrice)
        const currentValue = betSide === 'YES'
            ? remainingShares * currentPrice
            : remainingShares * (1 - currentPrice);
        const currentInvested = remainingShares * betPrice;
        const currentReturn = (currentValue - currentInvested) / currentInvested;

        if (currentReturn > maxReturn) maxReturn = currentReturn;

        // 1. MAX LOSS CAP
        if (currentReturn <= maxLossCap) {
            const exitPnl = currentValue - currentInvested - slippageCost - fees;
            return { pnl: realizedPnl + exitPnl, exitPrice: currentPrice, exitType: 'MAX_LOSS_CAP', exitStep: step };
        }

        // 2. STOP LOSS (dynamic, category-based)
        let effectiveSL = stopLossLevel;
        // Time decay: tighten after half the timeout
        if (step > timeoutSteps / 2) {
            effectiveSL += (CONFIG.DYNAMIC_SL?.TIME_DECAY_PENALTY || 0.05);
        }

        if (currentReturn <= effectiveSL) {
            const exitPnl = currentValue - currentInvested - slippageCost - fees;
            return { pnl: realizedPnl + exitPnl, exitPrice: currentPrice, exitType: 'STOP_LOSS', exitStep: step };
        }

        // 3. TRAILING STOP
        if (maxReturn >= trailingActivation) {
            const trailingLevel = maxReturn - trailingDistance;
            if (currentReturn <= trailingLevel && currentReturn > 0) {
                const exitPnl = currentValue - currentInvested - slippageCost - fees;
                return { pnl: realizedPnl + exitPnl, exitPrice: currentPrice, exitType: 'TRAILING_STOP', exitStep: step };
            }
        }

        // 4. TAKE PROFIT (partial on first hit, full on extended target)
        if (!partialExitDone && currentReturn >= tpPercent) {
            // Partial exit: sell 50%
            const partialShares = remainingShares * partialExitRatio;
            const partialValue = betSide === 'YES'
                ? partialShares * currentPrice
                : partialShares * (1 - currentPrice);
            const partialInvested = partialShares * betPrice;
            realizedPnl += (partialValue - partialInvested) - (slippageCost * partialExitRatio) - (fees * partialExitRatio);
            remainingShares -= partialShares;
            partialExitDone = true;
            // Continue with remainder for extended TP
            tpPercent *= (smartExit.EXTENDED_TP_MULTIPLIER || 2.0);
        }

        if (partialExitDone && currentReturn >= tpPercent) {
            // Full exit on extended target
            const exitPnl = currentValue - (remainingShares * betPrice) - (slippageCost * (1 - partialExitRatio)) - (fees * (1 - partialExitRatio));
            return { pnl: realizedPnl + exitPnl, exitPrice: currentPrice, exitType: 'TAKE_PROFIT', exitStep: step };
        }

        // 5. TIMEOUT
        if (step >= timeoutSteps) {
            const exitPnl = currentValue - currentInvested - slippageCost - fees;
            return { pnl: realizedPnl + exitPnl, exitPrice: currentPrice, exitType: 'TIMEOUT', exitStep: step };
        }
    }

    // End of price path: resolve at settlement
    const finalPnl = calculateRealPnL(remainingShares * betPrice, betPrice, actualWinner, betSide, slippage);
    return { pnl: realizedPnl + finalPnl, exitPrice: actualWinner === betSide ? 1.0 : 0.0, exitType: 'RESOLUTION', exitStep: pricePath.length };
}

function calculateRealPnL(betAmount, betPrice, actualWinner, betSide, slippage = DEFAULT_SLIPPAGE) {
    const slippageCost = betAmount * slippage;
    const fees = betAmount * POLYMARKET_FEES; // Fees on ALL trades, not just wins

    if (betSide === actualWinner) {
        const shares = betAmount / betPrice;
        const grossProfit = shares - betAmount;
        return grossProfit - slippageCost - fees;
    } else {
        return -(betAmount + slippageCost + fees);
    }
}

function calculateMetrics(tradeResults, initialCapital) {
    if (tradeResults.length === 0) {
        return {
            sharpeRatio: 0, maxDrawdown: 0, roi: 0,
            avgReturnPerTrade: 0, stdDev: 0,
            sampleSize: 0, isReliable: false
        };
    }

    const returns = tradeResults.map(t => t.pnl);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) : 0;

    let peak = initialCapital, maxDrawdown = 0, capital = initialCapital;
    returns.forEach(r => {
        capital += r;
        if (capital > peak) peak = capital;
        const drawdown = (peak - capital) / peak;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    const totalReturn = returns.reduce((a, b) => a + b, 0);
    const roi = (totalReturn / initialCapital) * 100;

    return {
        sharpeRatio, maxDrawdown: maxDrawdown * 100, roi,
        avgReturnPerTrade: avgReturn, stdDev,
        sampleSize: tradeResults.length,
        isReliable: tradeResults.length >= 50
    };
}

/**
 * Run the backtest on a set of markets.
 * Separated from runBacktestSimulation to allow train/test split (Fix G).
 */
async function runBacktestOnSet(marketSet, initialCapital, log) {
    const simCapital = { value: initialCapital };
    let wins = 0, losses = 0, ignored = 0;
    const tradeResults = [];

    // Simulated portfolio state (Fix E: accumulate across iterations)
    const simActiveTrades = [];
    const simClosedTrades = [];

    const backtestDependencies = {
        checkLiquidityDepthFn: async (market) => {
            const vol = parseFloat(market.volume24hr || 0);
            if (vol > 10000) return true;
            if (vol > 1000) return Math.random() > 0.3;
            return Math.random() > 0.6;
        },
        calculateIntradayTrendFn: async () => {
            const r = Math.random();
            if (r < 0.35) return 'UP';
            if (r < 0.65) return 'FLAT';
            return 'DOWN';
        },
        testSize: null,
        isTest: false,
        skipPersistence: true,
        enforcePortfolioLimits: true, // Phase 3: enforce category/direction limits in backtest
        reasonsCollector: []
    };

    // Exit simulation stats
    const exitStats = { STOP_LOSS: 0, TRAILING_STOP: 0, TAKE_PROFIT: 0, TIMEOUT: 0, MAX_LOSS_CAP: 0, RESOLUTION: 0 };

    for (const { market, actualWinner, originalQuestion, _priceHistory } of marketSet) {
        // Bankruptcy stop: halt if capital too low to trade
        if (simCapital.value < 50) {
            log(`💀 BANKRUPT: Capital $${simCapital.value.toFixed(2)} < $50 — halting simulation`);
            break;
        }

        backtestDependencies.reasonsCollector = [];

        // Fix B: Generate DEFCON per market (not once for entire backtest)
        const simDefcon = generateWeightedDEFCON();
        const simPizza = generateSimulatedTensionData(simDefcon);

        // SAFE BACKTEST: Temporarily swap botState for simulated values,
        // but use try/finally to GUARANTEE restoration even on crash.
        // saveNewTrade() no longer modifies botState when skipPersistence=true,
        // so capital changes are tracked via simCapital only.
        const savedCapital = botState.capital;
        const savedTrades = botState.activeTrades;
        const savedClosedTrades = botState.closedTrades;
        const savedCorrelationMap = botState._correlationMap;
        const savedStartingCapital = botState.startingCapital;

        let decision = null;
        try {
            // Set simulated state for engine reads (portfolio checks, exposure limits, etc.)
            botState.capital = simCapital.value;
            botState.startingCapital = initialCapital;
            botState.activeTrades = [...simActiveTrades];
            botState.closedTrades = [...simClosedTrades];

            decision = await simulateTrade(market, simPizza, false, backtestDependencies);
        } catch {
            ignored++;
        } finally {
            // ALWAYS restore real state, even if simulateTrade crashes
            botState.capital = savedCapital;
            botState.activeTrades = savedTrades;
            botState.closedTrades = savedClosedTrades;
            botState._correlationMap = savedCorrelationMap;
            botState.startingCapital = savedStartingCapital;
        }

        if (!decision || Array.isArray(decision)) {
            ignored++;
            continue;
        }

        const betSide = decision.side;
        const betPrice = decision.entryPrice;
        const betAmount = Math.min(decision.amount, simCapital.value * 0.15);
        const tradeCategory = categorizeMarket(originalQuestion);

        // Phase 5: Variable slippage based on market liquidity
        const marketSlippage = estimateSlippage(market);

        // Deduct trade cost from simulated capital (since saveNewTrade no longer does it)
        simCapital.value -= betAmount;

        // Phase 4: Exit simulation (SL/TP/trailing) instead of instant resolution
        let pnl, exitType;
        if (CONFIG.BACKTEST?.ENABLE_EXIT_SIM) {
            // Find entry index in price history
            let entryIdx = undefined;
            if (_priceHistory && _priceHistory.length > 0) {
                const len = _priceHistory.length;
                entryIdx = Math.floor(len * 0.25) + Math.floor(Math.random() * Math.floor(len * 0.5));
            }
            const exitResult = simulateExitPath(betAmount, betPrice, betSide, actualWinner, tradeCategory, _priceHistory, entryIdx, marketSlippage);
            pnl = exitResult.pnl;
            exitType = exitResult.exitType;
            exitStats[exitType] = (exitStats[exitType] || 0) + 1;
        } else {
            pnl = calculateRealPnL(betAmount, betPrice, actualWinner, betSide, marketSlippage);
            exitType = 'RESOLUTION';
            exitStats.RESOLUTION++;
        }

        simCapital.value += betAmount + pnl; // Return principal + pnl

        // Phase 7: Tag with tension regime
        const tensionRegime = simPizza.tensionScore >= 80 ? 'CRITICAL'
            : simPizza.tensionScore >= 55 ? 'HIGH'
            : simPizza.tensionScore >= 30 ? 'ELEVATED'
            : 'NORMAL';

        // Phase 6: Derive strategy from decision reasons
        const reasons = decision.reasons || [];
        const reasonStr = reasons.join(' ').toLowerCase();
        let strategy = 'standard';
        if (reasonStr.includes('whale') || reasonStr.includes('🐋')) strategy = 'whale';
        else if (reasonStr.includes('copy') || reasonStr.includes('leaderboard')) strategy = 'copy';
        else if (reasonStr.includes('news') || reasonStr.includes('headline')) strategy = 'news';
        else if (reasonStr.includes('calendar')) strategy = 'calendar';
        else if (reasonStr.includes('wizard') || reasonStr.includes('trend')) strategy = 'trend';
        else if (reasonStr.includes('fresh')) strategy = 'fresh';
        else if (reasonStr.includes('anti-fragility') || reasonStr.includes('recovery')) strategy = 'anti-fragility';
        else if (reasonStr.includes('hype') || reasonStr.includes('fader')) strategy = 'hype_fader';

        const tradeResult = {
            pnl,
            side: betSide,
            price: betPrice,
            amount: betAmount,
            question: originalQuestion,
            actualWinner,
            confidence: decision.confidence,
            reasons,
            category: tradeCategory,
            marketId: market.id,
            exitType,
            strategy,
            tensionRegime
        };
        tradeResults.push(tradeResult);

        // Fix E: Add to simulated portfolio, then immediately "resolve"
        const simTrade = {
            marketId: market.id,
            side: betSide,
            entryPrice: betPrice,
            amount: betAmount,
            category: tradeResult.category,
            question: originalQuestion,
            convictionScore: decision.convictionScore || 0
        };

        // Add to active trades (portfolio constraint simulation)
        if (simActiveTrades.length < (CONFIG.BASE_MAX_TRADES || 10)) {
            simActiveTrades.push(simTrade);
        }

        // Resolve immediately (all backtest markets are resolved) -> move to closed
        const closedTrade = { ...simTrade, pnl, profit: pnl };
        simClosedTrades.unshift(closedTrade); // Most recent first

        // Remove from active after resolution
        const idx = simActiveTrades.findIndex(t => t.marketId === market.id);
        if (idx !== -1) simActiveTrades.splice(idx, 1);

        if (pnl >= 0) {
            wins++;
            log(`WIN  | ${originalQuestion.substring(0, 40)}... | ${betSide} @ ${betPrice.toFixed(3)} | +$${pnl.toFixed(2)} | ${exitType} | T${simPizza.tensionScore}`);
        } else {
            losses++;
            log(`LOSS | ${originalQuestion.substring(0, 40)}... | ${betSide} @ ${betPrice.toFixed(3)} | -$${Math.abs(pnl).toFixed(2)} | ${exitType} | T${simPizza.tensionScore}`);
        }
    }

    const metrics = calculateMetrics(tradeResults, initialCapital);
    const totalPnL = tradeResults.reduce((sum, t) => sum + t.pnl, 0);
    const finalCapital = initialCapital + totalPnL;
    const winrate = (wins + losses) > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '0';

    // Log exit stats
    const exitEntries = Object.entries(exitStats).filter(([, v]) => v > 0);
    if (exitEntries.length > 0) {
        log(`Exit Stats: ${exitEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    return {
        metrics,
        exitStats,
        summary: {
            initialCapital, finalCapital, totalPnL,
            wins, losses, ignored, winrate,
            tradesCount: wins + losses
        },
        tradeResults
    };
}

/**
 * Warm up advanced strategies with historical data before the trade loop (Fix D).
 * Populates Market Memory, Correlation Map, and Event Catalysts.
 */
/**
 * Phase 9: Monte Carlo simulation — resample trades to get confidence intervals.
 * Shuffles the order of trades 1000+ times to see if results are skill or luck.
 */
function runMonteCarloSimulation(tradeResults, initialCapital, nPaths = 1000) {
    if (!tradeResults || tradeResults.length < 5) return null;

    const pathResults = [];

    for (let i = 0; i < nPaths; i++) {
        // Resample trades with replacement
        const resampled = [];
        for (let j = 0; j < tradeResults.length; j++) {
            const idx = Math.floor(Math.random() * tradeResults.length);
            resampled.push(tradeResults[idx]);
        }

        // Calculate equity curve and metrics for this path
        let capital = initialCapital;
        let peak = initialCapital;
        let maxDrawdown = 0;
        let totalPnl = 0;

        for (const t of resampled) {
            capital += t.pnl;
            totalPnl += t.pnl;
            if (capital > peak) peak = capital;
            const dd = (peak - capital) / peak;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }

        const roi = (totalPnl / initialCapital) * 100;
        const returns = resampled.map(t => t.pnl);
        const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        const sharpe = stdDev > 0 ? avg / stdDev : 0;

        pathResults.push({ roi, maxDrawdown: maxDrawdown * 100, sharpe });
    }

    // Sort and extract percentiles
    const percentile = (arr, pct) => arr[Math.floor(arr.length * pct)] || 0;

    const rois = pathResults.map(p => p.roi).sort((a, b) => a - b);
    const drawdowns = pathResults.map(p => p.maxDrawdown).sort((a, b) => a - b);
    const sharpes = pathResults.map(p => p.sharpe).sort((a, b) => a - b);

    return {
        nPaths,
        roi: {
            p5: percentile(rois, 0.05).toFixed(2),
            p25: percentile(rois, 0.25).toFixed(2),
            median: percentile(rois, 0.5).toFixed(2),
            p75: percentile(rois, 0.75).toFixed(2),
            p95: percentile(rois, 0.95).toFixed(2)
        },
        maxDrawdown: {
            p5: percentile(drawdowns, 0.05).toFixed(2),
            median: percentile(drawdowns, 0.5).toFixed(2),
            p95: percentile(drawdowns, 0.95).toFixed(2)
        },
        sharpe: {
            p5: percentile(sharpes, 0.05).toFixed(3),
            median: percentile(sharpes, 0.5).toFixed(3),
            p95: percentile(sharpes, 0.95).toFixed(3)
        },
        probOfProfit: ((rois.filter(r => r > 0).length / nPaths) * 100).toFixed(1),
        probOfRuin: ((rois.filter(r => r < -30).length / nPaths) * 100).toFixed(1)
    };
}

function warmUpStrategies(marketSet, log) {
    // Clear previous backtest state
    clearMarketMemory();
    clearEventCatalysts();

    let memoryWarmed = 0;

    // Warm Market Memory with real price histories
    for (const { market, _priceHistory } of marketSet) {
        if (!_priceHistory || _priceHistory.length < 5) continue;

        // Feed price snapshots into Market Memory
        for (const point of _priceHistory) {
            const snapshot = {
                id: market.id,
                outcomePrices: [point.p.toFixed(4), (1 - point.p).toFixed(4)],
                volume24hr: market.volume24hr || 0
            };
            recordMarketSnapshot(snapshot);
        }
        memoryWarmed++;
    }

    // Build correlation map from all markets in the set
    const allMarkets = marketSet.map(entry => entry.market);
    const correlationMap = buildCorrelationMap(allMarkets);

    // Save to botState temporarily (will be restored per iteration)
    botState._correlationMap = correlationMap;

    // Seed event catalysts with synthetic PizzINT data (full tension format)
    const syntheticPizza = generateSimulatedTensionData(3);
    syntheticPizza.trends = [
        'Trump tariffs trade war economy',
        'Ukraine Russia ceasefire negotiations',
        'Bitcoin ETF SEC approval crypto',
        'Federal Reserve interest rate decision'
    ];
    detectCatalysts(syntheticPizza, allMarkets);

    log(`Strategy warmup: ${memoryWarmed} markets with price history, ${correlationMap.size} correlation entries`);
}

/**
 * Runs the full backtest simulation with walk-forward analysis (Fix G).
 * @returns {Promise<Object>} { metrics, logs, trades, summary, trainMetrics, testMetrics }
 */
export async function runBacktestSimulation(options = {}) {
    const outputLog = [];
    const log = (...args) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        outputLog.push(msg);
        console.log(...args);
    };

    const initialCapital = 1000;

    log('Fetching resolved markets...');
    const resolvedMarkets = await fetchResolvedMarkets(log);

    if (resolvedMarkets.length === 0) {
        return { error: 'No resolved markets found', logs: outputLog };
    }

    // Shuffle and take up to 100 markets (Fix C)
    const shuffled = resolvedMarkets.sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, 100);

    log(`Sample: ${sample.length} markets (${resolvedMarkets.length} total fetched)`);

    if (sample.length < 20) {
        log('WARNING: Low sample size, metrics may be unreliable');
    }

    // Warm up advanced strategies (Fix D)
    warmUpStrategies(sample, log);

    // Walk-Forward split: 70% train, 30% test (Fix G)
    const splitIdx = Math.floor(sample.length * 0.7);
    const trainSet = sample.slice(0, splitIdx);
    const testSet = sample.slice(splitIdx);

    log(`Walk-Forward: ${trainSet.length} train / ${testSet.length} test`);

    // Run training set
    log('--- TRAIN SET ---');
    const trainResult = await runBacktestOnSet(trainSet, initialCapital, log);

    // Run test set (validates generalization)
    log('--- TEST SET ---');
    // Re-warm strategies for test set too (they need memory)
    warmUpStrategies(testSet, log);
    const testResult = await runBacktestOnSet(testSet, initialCapital, log);

    // Combined metrics (for backward compatibility)
    const allTradeResults = [...trainResult.tradeResults, ...testResult.tradeResults];
    const combinedMetrics = calculateMetrics(allTradeResults, initialCapital);
    const totalPnL = allTradeResults.reduce((sum, t) => sum + t.pnl, 0);
    const finalCapital = initialCapital + totalPnL;
    const totalWins = trainResult.summary.wins + testResult.summary.wins;
    const totalLosses = trainResult.summary.losses + testResult.summary.losses;
    const totalIgnored = trainResult.summary.ignored + testResult.summary.ignored;
    const winrate = (totalWins + totalLosses) > 0
        ? (totalWins / (totalWins + totalLosses) * 100).toFixed(1) : '0';

    // Merge exit stats from train + test
    const combinedExitStats = {};
    for (const key of Object.keys(trainResult.exitStats || {})) {
        combinedExitStats[key] = (trainResult.exitStats[key] || 0) + (testResult.exitStats?.[key] || 0);
    }
    for (const key of Object.keys(testResult.exitStats || {})) {
        if (!combinedExitStats[key]) combinedExitStats[key] = testResult.exitStats[key];
    }

    // Phase 6: Per-strategy performance
    const strategyPerformance = {};
    const categoryPerformance = {};
    // Phase 7: Per-regime performance
    const regimePerformance = {};

    for (const t of allTradeResults) {
        // Strategy aggregation
        const s = t.strategy || 'standard';
        if (!strategyPerformance[s]) strategyPerformance[s] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
        strategyPerformance[s].count++;
        strategyPerformance[s].totalPnl += t.pnl;
        if (t.pnl >= 0) strategyPerformance[s].wins++; else strategyPerformance[s].losses++;

        // Category aggregation
        const c = t.category || 'other';
        if (!categoryPerformance[c]) categoryPerformance[c] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
        categoryPerformance[c].count++;
        categoryPerformance[c].totalPnl += t.pnl;
        if (t.pnl >= 0) categoryPerformance[c].wins++; else categoryPerformance[c].losses++;

        // Regime aggregation
        const r = t.tensionRegime || 'NORMAL';
        if (!regimePerformance[r]) regimePerformance[r] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
        regimePerformance[r].count++;
        regimePerformance[r].totalPnl += t.pnl;
        if (t.pnl >= 0) regimePerformance[r].wins++; else regimePerformance[r].losses++;
    }

    // Compute WR and avg PnL for each group
    for (const group of [strategyPerformance, categoryPerformance, regimePerformance]) {
        for (const key of Object.keys(group)) {
            const g = group[key];
            g.winRate = g.count > 0 ? ((g.wins / g.count) * 100).toFixed(1) : '0';
            g.avgPnl = g.count > 0 ? (g.totalPnl / g.count).toFixed(2) : '0';
        }
    }

    log('--- RESULTS ---');
    log(`Train: ROI ${trainResult.metrics.roi.toFixed(2)}% | Sharpe ${trainResult.metrics.sharpeRatio.toFixed(2)} | WR ${trainResult.summary.winrate}%`);
    log(`Test:  ROI ${testResult.metrics.roi.toFixed(2)}% | Sharpe ${testResult.metrics.sharpeRatio.toFixed(2)} | WR ${testResult.summary.winrate}%`);
    log(`Combined: ${totalWins}W ${totalLosses}L ${totalIgnored}I | ROI ${combinedMetrics.roi.toFixed(2)}% | $${initialCapital} -> $${finalCapital.toFixed(2)}`);
    const exitSummary = Object.entries(combinedExitStats).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ');
    if (exitSummary) log(`Exit Types: ${exitSummary}`);

    // Log strategy performance
    const stratKeys = Object.keys(strategyPerformance).filter(k => strategyPerformance[k].count >= 2);
    if (stratKeys.length > 0) {
        log(`Strategy Breakdown: ${stratKeys.map(k => `${k}(${strategyPerformance[k].winRate}% WR, n=${strategyPerformance[k].count})`).join(', ')}`);
    }

    // Log regime performance and flag weak regimes
    const regimeKeys = Object.keys(regimePerformance).filter(k => regimePerformance[k].count >= 2);
    if (regimeKeys.length > 0) {
        log(`Regime Breakdown: ${regimeKeys.map(k => `${k}(${regimePerformance[k].winRate}% WR, n=${regimePerformance[k].count})`).join(', ')}`);
    }
    for (const [regime, perf] of Object.entries(regimePerformance)) {
        if (perf.count >= 5 && perf.totalPnl / initialCapital < -0.20) {
            log(`REGIME WARNING: ${regime} has ROI ${((perf.totalPnl / initialCapital) * 100).toFixed(1)}% on ${perf.count} trades`);
        }
    }

    // Phase 9: Monte Carlo simulation (optional)
    let monteCarlo = null;
    if ((CONFIG.BACKTEST?.MONTE_CARLO_ENABLED || options.monteCarlo) && allTradeResults.length >= 10) {
        const mcPaths = CONFIG.BACKTEST.MONTE_CARLO_PATHS || 1000;
        monteCarlo = runMonteCarloSimulation(allTradeResults, initialCapital, mcPaths);
        if (monteCarlo) {
            log(`Monte Carlo (${mcPaths} paths): P(profit)=${monteCarlo.probOfProfit}% | ROI median=${monteCarlo.roi.median}% [${monteCarlo.roi.p5}% to ${monteCarlo.roi.p95}%] | P(ruin)=${monteCarlo.probOfRuin}%`);
        }
    }

    // Cleanup: clear backtest strategy state
    clearMarketMemory();
    clearEventCatalysts();

    return {
        metrics: combinedMetrics,
        trainMetrics: trainResult.metrics,
        testMetrics: testResult.metrics,
        exitStats: combinedExitStats,
        strategyPerformance,
        categoryPerformance,
        regimePerformance,
        monteCarlo,
        summary: {
            initialCapital, finalCapital, totalPnL,
            wins: totalWins, losses: totalLosses,
            ignored: totalIgnored, winrate,
            tradesCount: totalWins + totalLosses,
            trainSize: trainSet.length,
            testSize: testSet.length
        },
        logs: outputLog,
        tradeResults: allTradeResults
    };
}
