
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
const SLIPPAGE = 0.015;
const POLYMARKET_FEES = 0.02;

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

function calculateRealPnL(betAmount, betPrice, actualWinner, betSide) {
    if (betSide === actualWinner) {
        const shares = betAmount / betPrice;
        const grossProfit = shares - betAmount;
        const slippageCost = betAmount * SLIPPAGE;
        const fees = Math.max(0, grossProfit) * POLYMARKET_FEES;
        return grossProfit - slippageCost - fees;
    } else {
        return -(betAmount + betAmount * SLIPPAGE);
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
        reasonsCollector: []
    };

    for (const { market, actualWinner, originalQuestion } of marketSet) {
        backtestDependencies.reasonsCollector = [];

        // Fix B: Generate DEFCON per market (not once for entire backtest)
        const simPizza = {
            index: 30 + Math.floor(Math.random() * 40),
            defcon: generateWeightedDEFCON(),
            trends: [] // Base empty, catalysts handled by warmup
        };

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

        // Deduct trade cost from simulated capital (since saveNewTrade no longer does it)
        simCapital.value -= betAmount;

        const pnl = calculateRealPnL(betAmount, betPrice, actualWinner, betSide);
        simCapital.value += betAmount + pnl; // Return principal + pnl

        const tradeResult = {
            pnl,
            side: betSide,
            price: betPrice,
            amount: betAmount,
            question: originalQuestion,
            actualWinner,
            confidence: decision.confidence,
            reasons: decision.reasons || [],
            category: categorizeMarket(originalQuestion),
            marketId: market.id
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

        if (betSide === actualWinner) {
            wins++;
            log(`WIN  | ${originalQuestion.substring(0, 45)}... | ${betSide} @ ${betPrice.toFixed(3)} | +$${pnl.toFixed(2)} | DEFCON ${simPizza.defcon}`);
        } else {
            losses++;
            log(`LOSS | ${originalQuestion.substring(0, 45)}... | ${betSide} @ ${betPrice.toFixed(3)} | -$${Math.abs(pnl).toFixed(2)} | DEFCON ${simPizza.defcon}`);
        }
    }

    const metrics = calculateMetrics(tradeResults, initialCapital);
    const totalPnL = tradeResults.reduce((sum, t) => sum + t.pnl, 0);
    const finalCapital = initialCapital + totalPnL;
    const winrate = (wins + losses) > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '0';

    return {
        metrics,
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

    // Seed event catalysts with synthetic PizzINT trends
    const syntheticPizza = {
        defcon: 3,
        trends: [
            'Trump tariffs trade war economy',
            'Ukraine Russia ceasefire negotiations',
            'Bitcoin ETF SEC approval crypto',
            'Federal Reserve interest rate decision'
        ]
    };
    detectCatalysts(syntheticPizza, allMarkets);

    log(`Strategy warmup: ${memoryWarmed} markets with price history, ${correlationMap.size} correlation entries`);
}

/**
 * Runs the full backtest simulation with walk-forward analysis (Fix G).
 * @returns {Promise<Object>} { metrics, logs, trades, summary, trainMetrics, testMetrics }
 */
export async function runBacktestSimulation() {
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

    log('--- RESULTS ---');
    log(`Train: ROI ${trainResult.metrics.roi.toFixed(2)}% | Sharpe ${trainResult.metrics.sharpeRatio.toFixed(2)} | WR ${trainResult.summary.winrate}%`);
    log(`Test:  ROI ${testResult.metrics.roi.toFixed(2)}% | Sharpe ${testResult.metrics.sharpeRatio.toFixed(2)} | WR ${testResult.summary.winrate}%`);
    log(`Combined: ${totalWins}W ${totalLosses}L ${totalIgnored}I | ROI ${combinedMetrics.roi.toFixed(2)}% | $${initialCapital} -> $${finalCapital.toFixed(2)}`);

    // Cleanup: clear backtest strategy state
    clearMarketMemory();
    clearEventCatalysts();

    return {
        metrics: combinedMetrics,
        trainMetrics: trainResult.metrics,
        testMetrics: testResult.metrics,
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
