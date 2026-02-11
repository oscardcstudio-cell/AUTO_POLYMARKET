
import { simulateTrade } from '../src/logic/engine.js';
import { riskManager } from '../src/logic/riskManagement.js';
import { botState } from '../src/state.js';

// Mock dependencies to avoid external API calls
const mockDependencies = {
    checkLiquidityDepthFn: async () => true, // Always enough liquidity
    calculateIntradayTrendFn: async () => 'UP', // Always trending up
    testSize: 10, // Fixed trade size
    isTest: true,
    reasonsCollector: []
};

// Mock Market: Penny Stock ($0.02)
const pennyMarket = {
    id: 'test-penny-stock',
    question: 'Will Penny Stock Moon?',
    outcomePrices: ['0.02', '0.98'], // YES is 0.02
    volume24hr: 50000,
    liquidityNum: 10000,
    clobTokenIds: ['tokenYes', 'tokenNo'] // Fake tokens
};

// Mock Clob API (we need to mock getBestExecutionPrice if engine calls it)
// We'll rely on engine.js logic. Since I can't easily mock imports in ES6 without a framework,
// I'll rely on the fact that simulateTrade logic checks `market.clobTokenIds`.
// If I provide clobTokenIds, it tries to fetch REAL price.
// To bypass CLOB check network call or failure, I can remove clobTokenIds from mock 
// OR I have to mock the import. 
// For this quick test, I'll remove `clobTokenIds` so it skips the "Real Execution Price" check 
// BUT wait, engine requires CLOB IDs or it returns "No CLOB IDs - Cannot verify real price".
// Line 412: if (!market.clobTokenIds) return null.
// So I MUST provide them. And I MUST mock the API response.

// Since I cannot mock ES modules easily in this script without rewiring, 
// I will temporarily assume the engine will fail on CLOB check for this test script 
// UNLESS I use a specialized test runner.

// ALTERNATIVE: I can inspect `riskManager.canTrade` output directly, 
// but the user wants to test the ENGINE flow (the `if (price < 0.05)` check).

// Let's try to run it. If it fails on CLOB, that's fine, as long as it passes the Penny Stock check FIRST.
// The Penny Stock check (line 312 in engine.js) happens BEFORE CLOB check (line 370).
// If it fails at line 312, it returns null immediately.
// If it reaches CLOB check, it means it PASSED the Penny Stock check.

console.log("🧪 TESTING ENGINE LOGIC FOR PENNY STOCKS...\n");

async function runTest() {
    // 1. TEST SAFE MODE
    console.log("🔒 CASE 1: SAFE MODE");
    riskManager.setProfile('SAFE');
    console.log(`   Profile: ${riskManager.getProfile().label}`);

    mockDependencies.reasonsCollector = [];
    let result = await simulateTrade(pennyMarket, { index: 50, defcon: 5 }, false, mockDependencies);

    let reasons = mockDependencies.reasonsCollector;
    let pennyFilterTriggered = reasons.some(r => r.includes("Penny Stock Filter"));

    if (pennyFilterTriggered && !result) {
        console.log("   ✅ SUCCESS: Penny Stock rejected in SAFE mode.");
        console.log(`   Reason: ${reasons.find(r => r.includes("Penny Stock Filter"))}`);
    } else {
        console.log("   ❌ FAILED: Penny Stock should have been rejected.");
        console.log("   Result:", result ? "Trade Created" : "Null");
        console.log("   Reasons:", reasons);
    }
    console.log("");

    // 2. TEST YOLO MODE
    console.log("🔥 CASE 2: YOLO MODE");
    riskManager.setProfile('YOLO');
    console.log(`   Profile: ${riskManager.getProfile().label}`);

    mockDependencies.reasonsCollector = [];
    // Note: It will likely fail at CLOB check, but we want to confirm it does NOT fail at Penny Stock check.
    result = await simulateTrade(pennyMarket, { index: 50, defcon: 5 }, false, mockDependencies);

    reasons = mockDependencies.reasonsCollector;
    pennyFilterTriggered = reasons.some(r => r.includes("Penny Stock Filter"));
    const clobFailTriggered = reasons.some(r => r.includes("No CLOB IDs") || r.includes("CLOB Check Failed") || r.includes("cannot verify real price"));
    // Actually, since I didn't mock `getBestExecutionPrice`, it will likely throw or return null inside engine.
    // The engine captures catch(e) and prints console.warn.

    if (!pennyFilterTriggered) {
        console.log("   ✅ SUCCESS: Penny Stock filter PASSED (Not Triggered).");
        console.log("   (Trade proceeded to next checks, e.g. CLOB)");
    } else {
        console.log("   ❌ FAILED: Penny Stock was REJECTED even in YOLO mode!");
        console.log(`   Reason: ${reasons.find(r => r.includes("Penny Stock Filter"))}`);
    }
}

runTest();
