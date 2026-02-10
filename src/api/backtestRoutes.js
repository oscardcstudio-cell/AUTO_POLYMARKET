
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { simulateTrade } from '../logic/engine.js';
import { botState } from '../state.js';
import { supabase } from '../services/supabaseService.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(process.cwd(), 'public_history_data.json'); // Use process.cwd() for reliable path

// REALISTIC COSTS (Best Practice 2026)
const SLIPPAGE = 0.015;  // 1.5% slippage
const POLYMARKET_FEES = 0.02;  // 2% on profit

// MOCK DEPENDENCIES
const mockDependencies = {
    checkLiquidityDepthFn: async () => true,
    calculateIntradayTrendFn: async () => 'UP',
    testSize: 100,
    isTest: true,
    reasonsCollector: []
};

const mockPizza = { index: 50, defcon: 3 };

// Calculate realistic PnL with fees and slippage
function calculateRealPnL(betAmount, betPrice, actualWinner, betSide) {
    if (betSide === actualWinner) {
        // WIN: (shares * 1) - betAmount
        const shares = betAmount / betPrice;
        const grossProfit = shares - betAmount;

        // Apply slippage on entry
        const slippageCost = betAmount * SLIPPAGE;

        // Apply fees on profit only
        const fees = Math.max(0, grossProfit) * POLYMARKET_FEES;

        return grossProfit - slippageCost - fees;
    } else {
        // LOSS: lose betAmount + slippage
        return -(betAmount + betAmount * SLIPPAGE);
    }
}

// Check for arbitrage opportunity
function checkArbitrageOpportunity(market) {
    const yesPrice = market.outcomePrices ? parseFloat(market.outcomePrices[0]) : 0.5;
    const noPrice = market.outcomePrices ? parseFloat(market.outcomePrices[1]) : 0.5;

    // Binary Complement Arbitrage: if YES + NO < 1, guaranteed profit
    if (yesPrice + noPrice < 0.98) {  // 0.98 to account for fees
        return {
            type: 'BINARY_COMPLEMENT_ARB',
            guaranteedProfit: 1 - (yesPrice + noPrice),
            yesPrice,
            noPrice
        };
    }
    return null;
}

// Calculate advanced metrics
function calculateMetrics(tradeResults, initialCapital) {
    if (tradeResults.length === 0) return null;

    const returns = tradeResults.map(t => t.pnl);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

    // Standard deviation of returns
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Sharpe Ratio (assuming risk-free rate = 0 for simplicity)
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) : 0;

    // Max Drawdown calculation
    let peak = initialCapital;
    let maxDrawdown = 0;
    let capital = initialCapital;

    returns.forEach(r => {
        capital += r;
        if (capital > peak) peak = capital;
        const drawdown = (peak - capital) / peak;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // Total return
    const totalReturn = returns.reduce((a, b) => a + b, 0);
    const roi = (totalReturn / initialCapital) * 100;

    return {
        sharpeRatio,
        maxDrawdown: maxDrawdown * 100,
        roi,
        avgReturnPerTrade: avgReturn,
        stdDev
    };
}

router.post('/run-backtest', async (req, res) => {
    // Capture stdout/console log for response output
    const outputLog = [];
    const originalLog = console.log;
    const originalError = console.error;

    // Custom logger
    const log = (...args) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        outputLog.push(msg);
        originalLog(...args); // Keep logging to server console too
    };

    // Replace globals temporarily (risky if parallel requests, but okay for single instance bot)
    // Actually, safer to pass log function inside, but for simplicity let's rely on captured array for response construction
    // and just use log() instead of console.log inside the logic block.
    // I will rewrite the logic block to use local log function.

    try {
        log('🧪 ========================================');
        log('   ADVANCED POLYMARKET BACKTEST (API)');
        log('========================================\n');

        const initialCapital = 1000;
        // Don't touch real bot state capital
        // botState.capital = initialCapital; 

        if (!fs.existsSync(DATA_FILE)) {
            log('❌ Data file not found. Please run fetch_public_history.js locally and push data.');
            return res.json({ success: false, error: 'Data file missing', output: outputLog.join('\n') });
        }

        const trainingSet = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        log(`📊 Analyzing ${trainingSet.length} historical markets (Simulated)...\n`);

        let wins = 0;
        let losses = 0;
        let ignored = 0;
        let arbitrageFound = 0;
        const tradeResults = [];

        for (const example of trainingSet) {
            const market = example.simulated_market_state;

            // Check for arbitrage first
            const arbOpp = checkArbitrageOpportunity(market);
            if (arbOpp) {
                arbitrageFound++;
                log(`💎 ARB | ${market.question.substring(0, 40)}... | Profit: ${(arbOpp.guaranteedProfit * 100).toFixed(2)}%`);
            }

            const decision = await simulateTrade(market, mockPizza, false, mockDependencies);

            if (!decision) {
                ignored++;
                continue;
            }

            const trade = decision;
            const betSide = trade.side;
            const betPrice = trade.entryPrice;
            const betAmount = trade.amount;
            const actualWinner = example.actual_winner;

            // Calculate REALISTIC PnL with fees and slippage
            const pnl = calculateRealPnL(betAmount, betPrice, actualWinner, betSide);

            tradeResults.push({
                pnl,
                side: betSide,
                price: betPrice,
                amount: betAmount,
                question: market.question
            });

            if (betSide === actualWinner) {
                wins++;
                log(`✅ WIN  | ${market.question.substring(0, 40)}... | ${betSide} @ ${betPrice.toFixed(2)} | +$${pnl.toFixed(2)}`);
            } else {
                losses++;
                log(`❌ LOSS | ${market.question.substring(0, 40)}... | ${betSide} @ ${betPrice.toFixed(2)} | -$${Math.abs(pnl).toFixed(2)}`);
            }
        }

        // Calculate advanced metrics
        const metrics = calculateMetrics(tradeResults, initialCapital);
        const totalPnL = tradeResults.reduce((sum, t) => sum + t.pnl, 0);
        const finalCapital = initialCapital + totalPnL;

        log('\n========================================');
        log('🏆 BACKTEST RESULTS');
        log('========================================\n');

        log('📊 BASIC STATS:');
        log(`   Markets Scanned: ${trainingSet.length}`);
        log(`   Trades Taken: ${wins + losses}`);
        log(`   Ignored: ${ignored}`);
        log(`   Arbitrage Opportunities: ${arbitrageFound}`);
        log();

        log('💰 PERFORMANCE:');
        log(`   Wins: ${wins}`);
        log(`   Losses: ${losses}`);
        const winrate = (wins + losses) > 0 ? (wins / (wins + losses) * 100).toFixed(1) : 0;
        log(`   Winrate: ${winrate}%`);
        log();

        log('💵 CAPITAL:');
        log(`   Initial: $${initialCapital.toFixed(2)}`);
        log(`   Final: $${finalCapital.toFixed(2)}`);
        log(`   Total PnL: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`);
        log(`   ROI: ${metrics ? metrics.roi.toFixed(2) : '0'}%`);
        log();

        if (metrics) {
            log('📈 ADVANCED METRICS:');
            log(`   Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`);
            log(`   Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}%`);
            log();
        }

        // Save results to Supabase (Optional for API run)
        if (supabase) {
            try {
                await supabase
                    .from('simulation_runs')
                    .insert({
                        strategy_config: {
                            sharpeRatio: metrics ? metrics.sharpeRatio : 0,
                            winrate: parseFloat(winrate),
                            maxDrawdown: metrics ? metrics.maxDrawdown : 0,
                            avgReturnPerTrade: metrics ? metrics.avgReturnPerTrade : 0,
                            source: 'API_TRIGGERED'
                        },
                        result_pnl: totalPnL,
                        result_roi: metrics ? metrics.roi : 0,
                        trade_count: wins + losses
                    });
                log('✅ Results saved to Supabase (History).');
            } catch (e) {
                log('⚠️ Supabase save error: ' + e.message);
            }
        }

        res.json({
            success: true,
            output: outputLog.join('\n'),
            result: metrics,
            stats: {
                wins, losses, winrate, totalPnL
            }
        });

    } catch (error) {
        log('❌ Fatal Error: ' + error.message);
        res.json({
            success: false,
            error: error.message,
            output: outputLog.join('\n')
        });
    }
});

export default router;
