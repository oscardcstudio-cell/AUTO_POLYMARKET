
import { getTrendingMarkets } from './src/api/market_discovery.js';

async function checkSignalsData() {
    console.log("Fetching Trending Markets...");
    try {
        const markets = await getTrendingMarkets(5);
        console.log(`Fetched ${markets.length} markets.`);

        if (markets.length > 0) {
            markets.forEach((m, i) => {
                console.log(`[${i}] ID: ${m.id}`);
                console.log(`    Question: ${m.question}`);
                console.log(`    clobTokenIds:`, m.clobTokenIds);
                if (!m.clobTokenIds || m.clobTokenIds.length === 0) {
                    console.error("    ❌ MISSING CLOB TOKEN IDS");
                } else {
                    console.log("    ✅ Has CLOB IDs");
                }
            });
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

checkSignalsData();
