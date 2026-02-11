
import { simulateTrade, checkAndCloseTrades } from '../src/logic/engine.js';
import { riskManager } from '../src/logic/riskManagement.js';
import { botState } from '../src/state.js';
import { CONFIG } from '../src/config.js';

// Mock botState
botState.capital = 1000;
botState.apiStatus.clob = 'ONLINE';

// Mock Market that satisfies BULL_RUN or CONTRARIAN
const now = new Date();
const endDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days from now

const fallbackMarket = {
    id: 'test-fallback-market',
    question: 'Israel Military Strike Lebanon?', // Geopolitical
    outcomePrices: ['0.50', '0.50'],
    clobTokenIds: null, // Simulation of missing IDs
    endDate: endDate.toISOString(),
    volume24hr: 100000,
    liquidityNum: 10000,
    category: 'geopolitical'
};

const mockDeps = {
    checkLiquidityDepthFn: async () => true,
    calculateIntradayTrendFn: async () => 'UP',
    testSize: 10,
    isTest: true,
    reasonsCollector: []
};

async function runTest() {
    console.log("🧪 TESTING GAMMA FALLBACK & AUDIT...\n");

    // 1. TEST SAFE MODE (Should fail)
    console.log("🔒 CASE 1: SAFE MODE (No Fallback)");
    riskManager.setProfile('SAFE');
    mockDeps.reasonsCollector = [];
    let result = await simulateTrade(fallbackMarket, { index: 95, defcon: 1 }, false, mockDeps);

    if (!result && mockDeps.reasonsCollector.some(r => r.includes("Skipped (SAFE/MEDIUM mode)"))) {
        console.log("   ✅ SUCCESS: Correctly skipped in SAFE mode.");
    } else {
        console.log("   ❌ FAILED: Should have skipped with explicit message.");
        console.log("   Reasons:", mockDeps.reasonsCollector);
    }

    // 2. TEST YOLO MODE (Should proceed with penalty)
    console.log("\n🔥 CASE 2: YOLO MODE (Fallback with Penalty)");
    riskManager.setProfile('YOLO');
    mockDeps.reasonsCollector = [];
    result = await simulateTrade(fallbackMarket, { index: 95, defcon: 1 }, false, mockDeps);

    if (result && result.priceSource === 'GAMMA_FALLBACK') {
        process.stdout.write("   ✅ SUCCESS: Trade entered via GAMMA_FALLBACK.\n");
        console.log(`   Entry Price (with 1.5% penalty): ${result.entryPrice.toFixed(4)} (Original: 0.50)`);

        // 3. TEST AUDIT DRIFT
        console.log("\n📊 CASE 3: AUDIT DRIFT CHECK");
        // Simulate that after some time, CLOB IDs appear
        result.clobTokenIds = ['token1', 'token2'];
        botState.activeTrades = [result];

        console.log("   Trade object contains CLOB IDs now.");
        console.log("   The engine will audit this drift on the next checkAndCloseTrades run.");
    } else {
        console.log("   ❌ FAILED: Trade should have been allowed in YOLO mode.");
        console.log("   Reasons:", mockDeps.reasonsCollector);
    }
}

runTest();
