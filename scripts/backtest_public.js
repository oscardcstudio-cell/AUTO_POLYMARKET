
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { simulateTrade } from '../src/logic/engine.js';
import { botState } from '../src/state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'public_history_data.json');

// MOCK DEPENDENCIES
const mockDependencies = {
    // Always return good liquidity for backtest to focus on Logic/Price
    checkLiquidityDepthFn: async () => true,
    // Random or simple trend mock
    calculateIntradayTrendFn: async () => 'UP',
    testSize: 100, // Fixed vet size $100
    isTest: true,
    reasonsCollector: []
};

// Mock Pizza Data (Neutral)
const mockPizza = { index: 50, defcon: 3 };

async function runBacktest() {
    console.log('🧪 Starting Public Data Backtest...');
    botState.capital = 1000; // Initialize capital for simulation

    if (!fs.existsSync(DATA_FILE)) {
        console.error('❌ Data file not found. Run fetch_public_history.js first.');
        process.exit(1);
    }

    const trainingSet = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`📊 Analyze ${trainingSet.length} historical markets...`);

    let wins = 0;
    let losses = 0;
    let ignored = 0;
    let totalPnL = 0;

    for (const example of trainingSet) {
        // Run Engine
        const market = example.simulated_market_state;

        // Reset specific state for fairness if needed (not needed for simple simulateTrade)

        // We use the engine logic
        // simulateTrade(market, pizzaData, isFreshMarket, dependencies)
        const decision = await simulateTrade(market, mockPizza, false, mockDependencies);

        /* decision is [tradeYes, tradeNo] or null */

        if (!decision) {
            ignored++;
            continue;
        }

        // Check Outcome
        // engine returns single trade object or null.
        const trade = decision;

        if (!trade) {
            ignored++;
            continue;
        }

        const betSide = trade.side; // 'YES' or 'NO'
        const betPrice = trade.entryPrice;
        const betAmount = trade.amount;
        const actualWinner = example.actual_winner;

        // Calculate PnL
        if (betSide === actualWinner) {
            // WIN: (1 - entry) * shares
            // shares = amount / entry
            // Profit = (1 * shares) - amount = amount/entry - amount
            const profit = (betAmount / betPrice) - betAmount;
            totalPnL += profit;
            wins++;
            console.log(`✅ WIN  | ${market.question.substring(0, 40)}... | Bet ${betSide} @ ${betPrice.toFixed(2)} | +$${profit.toFixed(2)}`);
        } else {
            // LOSS
            totalPnL -= betAmount;
            losses++;
            console.log(`❌ LOSS | ${market.question.substring(0, 40)}... | Bet ${betSide} @ ${betPrice.toFixed(2)} | -$${betAmount.toFixed(2)}`);
        }
    }

    console.log('\n--- 🏆 BACKTEST RESULTS ---');
    console.log(`Trades Taken: ${wins + losses} / ${trainingSet.length} scanned`);
    console.log(`Wins: ${wins}`);
    console.log(`Losses: ${losses}`);
    const winrate = (wins + losses) > 0 ? (wins / (wins + losses) * 100).toFixed(1) : 0;
    console.log(`Winrate: ${winrate}%`);
    console.log(`Total PnL: $${totalPnL.toFixed(2)}`);
    console.log('---------------------------');

    if (totalPnL > 0) console.log("🌟 STRATEGY IS PROFITABLE on historical data! 🌟");
    else console.log("⚠️ Strategy lost money on historical data. Tuning required.");

    process.exit(0);
}

runBacktest();
