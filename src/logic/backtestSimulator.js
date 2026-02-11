
import { simulateTrade } from './engine.js';
import { botState } from '../state.js';
// Removed explicit supabase import if not used directly, or keep if needed for archiving results here?
// Actually, backtestRoutes handles the response. 
// But if we run this from scheduler, we might want to save results here or in the caller.
// Let's return the results and let the caller handle saving/logging.

// REALISTIC COSTS
const SLIPPAGE = 0.015;
const POLYMARKET_FEES = 0.02;

/**
 * Fetch real resolved markets from Polymarket's public API.
 */
async function fetchResolvedMarkets(limit = 50, offset = 0) {
    try {
        const url = `https://gamma-api.polymarket.com/events?closed=true&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const events = await response.json();

        const resolvedMarkets = [];

        for (const event of events) {
            if (!event.markets || event.markets.length === 0) continue;

            for (const market of event.markets) {
                if (!market.outcomePrices) continue;

                let prices;
                try {
                    prices = typeof market.outcomePrices === 'string'
                        ? JSON.parse(market.outcomePrices)
                        : market.outcomePrices;
                } catch (e) { continue; }

                if (!Array.isArray(prices) || prices.length < 2) continue;

                const yesPrice = parseFloat(prices[0]);
                const noPrice = parseFloat(prices[1]);

                let actualWinner = null;
                if (yesPrice > 0.95) actualWinner = 'YES';
                else if (noPrice > 0.95) actualWinner = 'NO';
                else continue;

                const preResolutionSnapshot = {
                    ...market,
                    outcomePrices: market.outcomePrices, // Keep as-is, engine will parse
                    _isBacktestMarket: true
                };

                const volume = parseFloat(market.volume || market.volumeNum || 0);
                const liquidity = parseFloat(market.liquidityNum || 0);

                let simYesPrice, simNoPrice;
                if (actualWinner === 'YES') {
                    simYesPrice = 0.40 + Math.random() * 0.40; // 0.40-0.80
                    simNoPrice = 1 - simYesPrice;
                } else {
                    simNoPrice = 0.40 + Math.random() * 0.40;
                    simYesPrice = 1 - simNoPrice;
                }

                preResolutionSnapshot.outcomePrices = [
                    simYesPrice.toFixed(4),
                    simNoPrice.toFixed(4)
                ];

                preResolutionSnapshot.volume24hr = volume || Math.random() * 50000;
                preResolutionSnapshot.liquidityNum = liquidity || Math.random() * 10000;

                resolvedMarkets.push({
                    market: preResolutionSnapshot,
                    actualWinner,
                    originalQuestion: market.question
                });
            }
        }
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
            sharpeRatio: 0,
            maxDrawdown: 0,
            roi: 0,
            avgReturnPerTrade: 0,
            stdDev: 0
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

    return { sharpeRatio, maxDrawdown: maxDrawdown * 100, roi, avgReturnPerTrade: avgReturn, stdDev };
}

/**
 * Runs the backtest simulation.
 * @returns {Promise<Object>} { metrics, logs, trades, summary }
 */
export async function runBacktestSimulation() {
    const outputLog = [];
    const log = (...args) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        outputLog.push(msg);
        console.log(...args); // Keep console logging for server debug
    };

    const initialCapital = 1000;
    const simCapital = { value: initialCapital };

    log('📡 Fetching resolved markets...');
    const randomOffset = Math.floor(Math.random() * 200);
    const resolvedMarkets = await fetchResolvedMarkets(50, randomOffset);

    if (resolvedMarkets.length === 0) {
        return { error: 'No resolved markets found', logs: outputLog };
    }

    const shuffled = resolvedMarkets.sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, 30);

    let wins = 0, losses = 0, ignored = 0;
    const tradeResults = [];

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
        reasonsCollector: []
    };

    const simPizza = {
        index: 30 + Math.floor(Math.random() * 40),
        defcon: 3 + Math.floor(Math.random() * 3)
    };

    for (const { market, actualWinner, originalQuestion } of sample) {
        backtestDependencies.reasonsCollector = [];

        // Save state
        const savedCapital = botState.capital;
        const savedTrades = [...botState.activeTrades]; // Shallow copy array
        // We need to protect the actual botState object, not just the reference
        // But engine modifies botState properties.
        // Best approach: Mock botState entirely? No, engine imports it.
        // We must swap values.

        botState.capital = simCapital.value;
        botState.activeTrades = [];

        let decision = null;
        try {
            decision = await simulateTrade(market, simPizza, false, backtestDependencies);
        } catch (e) {
            ignored++;
        } finally {
            // Restore state immediately
            // But we need decision first
        }

        // Restore state
        botState.capital = savedCapital;
        botState.activeTrades = savedTrades;

        // If decision was made, undo side effects on the *simulated* state logic (which we just overwrote)
        // Wait. simulateTrade modifies botState.
        // We set botState to sim values, run simulateTrade, then restore.
        // So sim state changes (capital deduction) happened on botState.
        // But we overwrote botState.capital with simCapital.value.
        // So simCapital.value was NOT updated by simulateTrade because simulateTrade reads/writes botState.capital.
        // Actually, `simulateTrade` does `botState.capital -= trade.amount`.
        // So `simCapital.value` which we assigned to `botState.capital` is a primitive number.
        // `botState.capital` became that number.
        // `simulateTrade` modified `botState.capital`.
        // But `simCapital.value` variable itself is untouched because numbers are by value.
        // So we need to capture the *new* `botState.capital` before restoring!

        // Correct logic:
        // 1. Save Real State
        // 2. Set Bot State to Sim State
        // 3. Run Engine
        // 4. Capture Resulting Sim State (optional, if we want to track cash flow accurately)
        // 5. Restore Real State

        // But `simulateTrade` returns the trade decision. We calculate PnL manually here.
        // So we don't strictly *need* the engine's capital modification, 
        // as long as we don't let it leak to real bot.
        // And we restore `botState.capital = savedCapital` so we are safe.

        // Undo internal array mutations if any?
        // `botState.activeTrades` was set to empty array [], then modified.
        // detailed `savedTrades` is safe because we made a copy?
        // `const savedTrades = botState.activeTrades` -> checks reference.
        // If `botState.activeTrades` is replaced `botState.activeTrades = []`, `savedTrades` still points to old array.
        // So we are good.

        if (!decision || Array.isArray(decision)) {
            ignored++;
            continue;
        }

        const betSide = decision.side;
        const betPrice = decision.entryPrice;
        const betAmount = Math.min(decision.amount, simCapital.value * 0.15); // Cap sim bets

        const pnl = calculateRealPnL(betAmount, betPrice, actualWinner, betSide);
        simCapital.value += pnl;

        tradeResults.push({
            pnl,
            side: betSide,
            price: betPrice,
            amount: betAmount,
            question: originalQuestion,
            actualWinner,
            confidence: decision.confidence,
            reasons: decision.reasons || []
        });

        if (betSide === actualWinner) {
            wins++;
            log(`✅ WIN  | ${originalQuestion.substring(0, 45)}... | ${betSide} @ ${betPrice.toFixed(3)} | +$${pnl.toFixed(2)}`);
        } else {
            losses++;
            log(`❌ LOSS | ${originalQuestion.substring(0, 45)}... | ${betSide} @ ${betPrice.toFixed(3)} | -$${Math.abs(pnl).toFixed(2)}`);
        }
    }

    const metrics = calculateMetrics(tradeResults, initialCapital);
    const totalPnL = tradeResults.reduce((sum, t) => sum + t.pnl, 0);
    const finalCapital = initialCapital + totalPnL;
    const winrate = (wins + losses) > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '0';

    const summary = {
        initialCapital,
        finalCapital,
        totalPnL,
        wins,
        losses,
        ignored,
        winrate,
        tradesCount: wins + losses
    };

    return {
        metrics,
        summary,
        logs: outputLog,
        tradeResults
    };
}
