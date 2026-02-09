
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { simulateTrade } from '../src/logic/engine.js';
import { botState } from '../src/state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'public_history_data.json');

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

async function runBacktest() {
    console.log('🧪 ========================================');
    console.log('   ADVANCED POLYMARKET BACKTEST (2026)');
    console.log('========================================\n');

    const initialCapital = 1000;
    botState.capital = initialCapital;

    if (!fs.existsSync(DATA_FILE)) {
        console.error('❌ Data file not found. Run fetch_public_history.js first.');
        process.exit(1);
    }

    const trainingSet = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`📊 Analyzing ${trainingSet.length} historical markets...\n`);

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
            console.log(`💎 ARB | ${market.question.substring(0, 40)}... | Profit: ${(arbOpp.guaranteedProfit * 100).toFixed(2)}%`);
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
            console.log(`✅ WIN  | ${market.question.substring(0, 40)}... | ${betSide} @ ${betPrice.toFixed(2)} | +$${pnl.toFixed(2)}`);
        } else {
            losses++;
            console.log(`❌ LOSS | ${market.question.substring(0, 40)}... | ${betSide} @ ${betPrice.toFixed(2)} | -$${Math.abs(pnl).toFixed(2)}`);
        }
    }

    // Calculate advanced metrics
    const metrics = calculateMetrics(tradeResults, initialCapital);
    const totalPnL = tradeResults.reduce((sum, t) => sum + t.pnl, 0);
    const finalCapital = initialCapital + totalPnL;

    console.log('\n========================================');
    console.log('🏆 BACKTEST RESULTS');
    console.log('========================================\n');

    console.log('📊 BASIC STATS:');
    console.log(`   Markets Scanned: ${trainingSet.length}`);
    console.log(`   Trades Taken: ${wins + losses}`);
    console.log(`   Ignored: ${ignored}`);
    console.log(`   Arbitrage Opportunities: ${arbitrageFound}`);
    console.log();

    console.log('💰 PERFORMANCE:');
    console.log(`   Wins: ${wins}`);
    console.log(`   Losses: ${losses}`);
    const winrate = (wins + losses) > 0 ? (wins / (wins + losses) * 100).toFixed(1) : 0;
    console.log(`   Winrate: ${winrate}%`);
    console.log();

    console.log('💵 CAPITAL:');
    console.log(`   Initial: $${initialCapital.toFixed(2)}`);
    console.log(`   Final: $${finalCapital.toFixed(2)}`);
    console.log(`   Total PnL: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`);
    console.log(`   ROI: ${metrics ? metrics.roi.toFixed(2) : '0'}%`);
    console.log();

    if (metrics) {
        console.log('📈 ADVANCED METRICS (Best Practice 2026):');
        console.log(`   Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)} ${metrics.sharpeRatio > 2 ? '🌟 EXCELLENT' : metrics.sharpeRatio > 1 ? '✅ GOOD' : '⚠️ POOR'}`);
        console.log(`   Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}% ${metrics.maxDrawdown < 20 ? '✅' : '⚠️ HIGH RISK'}`);
        console.log(`   Avg Return/Trade: $${metrics.avgReturnPerTrade.toFixed(2)}`);
        console.log(`   Std Deviation: $${metrics.stdDev.toFixed(2)}`);
        console.log();
    }

    console.log('💸 COSTS (Realistic):');
    console.log(`   Slippage: ${(SLIPPAGE * 100).toFixed(1)}%`);
    console.log(`   Polymarket Fees: ${(POLYMARKET_FEES * 100).toFixed(0)}% on profits`);
    console.log();

    console.log('========================================');
    if (totalPnL > 0 && metrics && metrics.sharpeRatio > 1) {
        console.log('🌟 STRATEGY IS PROFITABLE! 🌟');
    } else if (totalPnL > 0) {
        console.log('⚠️ Profitable but high risk (low Sharpe Ratio)');
    } else {
        console.log('❌ Strategy lost money. Tuning required.');
    }
    console.log('========================================\n');

    process.exit(0);
}

runBacktest();
