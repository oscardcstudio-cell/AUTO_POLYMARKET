
// MOCK ENVIRONMENT
const botState = {
    activeTrades: [],
    lastPizzaData: null,
    capital: 1000
};

const logs = [];
function addLog(msg, type) {
    logs.push(`[${type.toUpperCase()}] ${msg}`);
    console.log(`[${type.toUpperCase()}] ${msg}`);
}

async function saveState() { console.log('(State Saved)'); }
async function getEventSlug() { return 'mock-slug'; }

// MOCK CONSTANTS
const CONFIG = { MIN_TRADE_SIZE: 10 };

// MOCK APIs
async function getMarketsByTags(tags) {
    console.log(`> Fetching markets for tags: ${tags}`);
    // Return fake conflict markets
    return [
        { id: 'm1', question: 'Will Israel invade Lebanon?', description: 'War', endDate: '2026-03-01' },
        { id: 'm2', question: 'Will NATO intervene?', description: 'Conflict', endDate: '2026-03-01' },
        { id: 'm3', question: 'Who wins the Super Bowl?', description: 'Sports', endDate: '2026-02-09' } // Noise
    ];
}

async function getTrendingMarkets(limit) {
    console.log(`> Fetching trending markets...`);
    return [
        { id: 't1', question: 'Trending Market #1', volume24hr: 100000 },
        { id: 't2', question: 'Trending Market #2', volume24hr: 50000 }
    ];
}

async function simulateTrade(market, data, force) {
    console.log(`> SIMULATING TRADE: ${market.question} (Force: ${force})`);
    return {
        id: `TRADE_${market.id}`,
        marketId: market.id,
        question: market.question,
        side: 'YES',
        size: 50
    };
}

// --- STRATEGY TO TEST (Copied from unified_bot.js) ---
async function checkStrategicOpportunities() {
    // Requires Pizza Data
    if (!botState.lastPizzaData) return;

    const { defcon, index } = botState.lastPizzaData;

    console.log(`\n--- RUNNING STRATEGY (DEFCON: ${defcon}, INDEX: ${index}) ---`);

    // 1. CRISIS STRATEGY (DEFCON 1-2)
    if (defcon <= 2) {
        addLog(`🚨 DEFCON ${defcon} DETECTED: Scanning for Conflict Markets...`, 'warning');

        const markets = await getMarketsByTags(['2']);
        for (const m of markets) {
            if (m.question.match(/(War|Conflict|Invad|Attack|Strike|Military)/i)) {
                const hasPosition = botState.activeTrades.some(t => t.marketId === m.id);
                if (!hasPosition) {
                    const trade = await simulateTrade(m, botState.lastPizzaData, true);
                    if (trade) {
                        addLog(`Global Crisis Trade: ${m.question}`, 'success');
                    }
                }
            }
        }
    }

    // 2. HIGH ACTIVITY STRATEGY (Index > 80)
    if (index > 80) {
        const trending = await getTrendingMarkets(10);
        if (trending.length > 0) {
            const target = trending[0];
            const hasPosition = botState.activeTrades.some(t => t.marketId === target.id);
            if (!hasPosition) {
                const trade = await simulateTrade(target, botState.lastPizzaData);
                if (trade) {
                    addLog(`High Activity Trade: ${target.question}`, 'success');
                }
            }
        }
    }
}

// --- TEST CASES ---
async function runTests() {
    // TEST 1: NORMAL
    botState.lastPizzaData = { defcon: 3, index: 50 };
    await checkStrategicOpportunities();
    if (logs.length === 0) console.log("✅ TEST 1 PASSED: Low activity, No trades.");

    // TEST 2: CRISIS
    logs.length = 0;
    botState.lastPizzaData = { defcon: 2, index: 40 }; // DEFCON 2
    await checkStrategicOpportunities();
    if (logs.some(l => l.includes("Crisis Trade"))) console.log("✅ TEST 2 PASSED: Crisis Trades triggered.");
    else console.error("❌ TEST 2 FAILED: No Crisis Trades.");

    // TEST 3: HIGH MOMENTUM
    logs.length = 0;
    botState.lastPizzaData = { defcon: 4, index: 90 }; // High Index
    await checkStrategicOpportunities();
    if (logs.some(l => l.includes("High Activity Trade"))) console.log("✅ TEST 3 PASSED: Momentum Trade triggered.");
    else console.error("❌ TEST 3 FAILED: No Momentum Trade.");
}

runTests();
