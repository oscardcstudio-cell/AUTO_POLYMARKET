import dotenv from 'dotenv';
import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';

// Load environment variables
dotenv.config();

/**
 * CONFIGURATION
 * Simple & Safe defaults
 */
const CONFIG = {
    SIMULATION_MODE: true, // Set to false ONLY when ready to trade real money
    POLL_INTERVAL_MS: 300000, // Check every 5 minutes (PizzINT is slower)
    MAX_TRADE_SIZE_USDC: 1.0,
    DEFCON_THRESHOLD: 3, // 1, 2 or 3 triggers interest
    RPC_URL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    RELEVANT_KEYWORDS: ['Pentagon', 'Israel', 'Iran', 'Hezbollah', 'War', 'Strike', 'Attack', 'Military', 'Geopolitical', 'Conflict', 'Trump'],
};

/**
 * STATE (In-memory for simulation)
 */
let simulationState = {
    totalProfit: 0,
    tradeCount: 0,
    lastUpdate: null,
    activeTrades: []
};

/**
 * DATA ACQUISITION: PizzINT
 */
async function fetchPizzaData() {
    try {
        const response = await fetch('https://www.pizzint.watch/api/dashboard-data', {
            headers: { 'Referer': 'https://www.pizzint.watch/' }
        });
        const data = await response.json();
        if (data && data.success) {
            return {
                index: data.overall_index,
                defcon: data.defcon_level,
                spikes: data.events ? data.events.length : 0
            };
        }
    } catch (error) {
        console.error("Error fetching PizzINT data:", error.message);
    }
    return null;
}

/**
 * MARKET DISCOVERY: Polymarket Expiring Soon
 */
async function fetchExpiringMarkets() {
    try {
        // Fetch markets ending soon (sorted by end date ascending)
        const response = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&order=endDateISO&ascending=true&limit=50');
        const markets = await response.json();

        if (!Array.isArray(markets)) return [];

        // Filter for relevant geopolitical markets
        return markets.filter(m => {
            const text = (m.question + ' ' + (m.description || '')).toLowerCase();
            return CONFIG.RELEVANT_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
        });
    } catch (error) {
        console.error("Error fetching markets:", error.message);
        return [];
    }
}

/**
 * TRADING LOGIC
 */
async function runBot() {
    console.log(`\n--- [${new Date().toISOString()}] Starting Bot Loop ---`);

    // 1. Get Pizza Signals
    const pizzaSignals = await fetchPizzaData();
    if (!pizzaSignals) return;

    console.log(`🍕 Pizza Index: ${pizzaSignals.index} | DOUGHCON: ${pizzaSignals.defcon} | Spikes: ${pizzaSignals.spikes}`);

    // Update global state for dashboard
    simulationState.lastUpdate = {
        pizza: pizzaSignals,
        timestamp: new Date().toISOString()
    };

    // 2. Market Discovery
    console.log("🔍 Searching for relevant short-term markets...");
    const relevantMarkets = await fetchExpiringMarkets();
    console.log(`Found ${relevantMarkets.length} relevant markets ending soon.`);

    // 3. Decision Logic
    if (pizzaSignals.defcon <= CONFIG.DEFCON_THRESHOLD) {
        console.log("🔥 ALERT: DOUGHCON level is elevated. Evaluating markets...");

        for (const market of relevantMarkets) {
            // Pick a market that is not yet "resolved" and has enough liquidity (simple check)
            if (parseFloat(market.liquidityNum) > 100) {
                await executeTradeSimulation(market);
            }
        }
    } else {
        console.log("✅ Situation normal. Watching and waiting.");
    }
}

async function executeTradeSimulation(market) {
    const outcomePrices = JSON.parse(market.outcomePrices);
    const yesPrice = parseFloat(outcomePrices[0]);

    // Simplified logic: If pizza index is high, we bet YES on tension
    console.log(`✨ [SIMULATION] TRADING: ${market.question}`);
    console.log(`   Price: ${yesPrice} | Side: YES | Size: ${CONFIG.MAX_TRADE_SIZE_USDC} USDC`);
    console.log(`   Market ends: ${market.endDateIso}`);

    simulationState.tradeCount++;
    simulationState.activeTrades.push({
        marketId: market.id,
        question: market.question,
        entryPrice: yesPrice,
        size: CONFIG.MAX_TRADE_SIZE_USDC,
        timestamp: new Date().toISOString(),
        endDate: market.endDateIso
    });
}

/**
 * MAIN ENTRY POINT
 */
async function main() {
    console.log("🚀 Auto Polymarket Bot - Short-Term Simulation Edition.");
    console.log("   Targeting Geo-Political markets ending soon.");

    // Initial run
    await runBot();

    // Polling
    setInterval(runBot, CONFIG.POLL_INTERVAL_MS);
}

// Export state for the dashboard server
export { simulationState };

main().catch(console.error);
