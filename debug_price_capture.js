
import { getRelevantMarkets } from './src/logic/signals.js';
import { getMidPrice } from './src/api/clob_api.js';

async function debugCapture() {
    console.log("🔍 [DEBUG] Starting Price Capture Monitor (Frequency: 10s)");
    console.log("---------------------------------------------------------");

    for (let i = 0; i < 6; i++) {
        console.log(`\n⏱️ [Cycle ${i + 1}/6] Time: ${new Date().toLocaleTimeString()}`);

        try {
            const markets = await getRelevantMarkets();
            const top5 = markets.slice(0, 5);

            console.table(top5.map(m => {
                let p = m.outcomePrices;
                if (typeof p === 'string') {
                    try { p = JSON.parse(p); } catch (e) { p = ['?', '?']; }
                }
                return {
                    Question: m.question.substring(0, 30),
                    Gamma_YES: p ? p[0] : 'N/A',
                    Gamma_NO: p ? p[1] : 'N/A',
                    Liquidity: parseFloat(m.liquidityNum || 0).toFixed(0)
                };
            }));

            const first = top5[0];
            console.log(`\n👉 Testing CLOB price for: ${first.question.substring(0, 40)}...`);
            if (first.clobTokenIds) {
                const price = await getMidPrice(first.clobTokenIds[0]);
                console.log(`   ✅ CLOB YES Price: ${price || 'NULL'}`);
            } else {
                console.log(`   ⚠️ No CLOB Token IDs for this market.`);
            }

        } catch (e) {
            console.error("❌ Error in cycle:", e.message);
        }

        await new Promise(r => setTimeout(r, 10000));
    }

    console.log("\n✅ [DEBUG] Monitor segment finished.");
}

debugCapture();
