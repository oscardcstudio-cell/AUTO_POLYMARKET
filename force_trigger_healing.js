
import { simulateTrade } from './src/logic/engine.js';
import { botState } from './src/state.js';

// Mock Config & State
botState.capital = 1000;
botState.activeTrades = [];
botState.logs = []; // CRITICAL for addLog

// Mock Market MISSING CLOB IDs
const flawedMarket = {
    id: "572473", // Real ID to allow fetch
    question: "Will Trump nominate Judy Shelton as the next Fed chair?",
    clobTokenIds: [], // INTENTIONALLY EMPTY
    outcomePrices: ["0.10", "0.90"],
    liquidityNum: 10000,
    volume24hr: 50000
};

// Mock Pizza Data
const pizzaData = { defcon: 5, index: 50 };

async function testHealing() {
    console.log("🧪 Testing Self-Healing using engine.js...");
    console.log("   Input Market has empty clobTokenIds.");

    const reasons = [];
    await simulateTrade(flawedMarket, pizzaData, false, {
        reasonsCollector: reasons,
        isTest: true
    });

    console.log("\n🔍 Post-Simulation Check:");
    console.log("   Market clobTokenIds:", flawedMarket.clobTokenIds);

    if (flawedMarket.clobTokenIds && flawedMarket.clobTokenIds.length === 2) {
        console.log("   ✅ SELF-HEALING SUCCESS: IDs were fetched and attached!");
    } else {
        console.log("   ❌ SELF-HEALING FAILED: Still missing IDs.");
    }
}

testHealing();
