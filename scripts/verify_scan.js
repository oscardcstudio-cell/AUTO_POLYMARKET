
import { getRelevantMarkets } from '../src/logic/signals.js';
import { getCLOBPrice } from '../src/api/clob_api.js';
import { botState } from '../src/state.js';
import { riskManager } from '../src/logic/riskManagement.js';

async function runVerificationScan() {
    console.log("🚀 STARTING VERIFICATION SCAN...");
    console.log(`Current Risk Profile: ${riskManager.getProfile().label}`);

    try {
        // 1. Test Market Discovery
        console.log("🔍 Fetching relevant markets...");
        const markets = await getRelevantMarkets(true); // Forced deep scan
        console.log(`✅ Success: Found ${markets.length} relevant markets.`);

        if (markets.length > 0) {
            const firstMarket = markets[0];
            console.log(`   Sample Market: "${firstMarket.question.substring(0, 50)}..."`);

            // 2. Test CLOB Pricing (with patched rate-limit safety)
            if (firstMarket.clobTokenIds && firstMarket.clobTokenIds.length > 0) {
                const tokenId = firstMarket.clobTokenIds[0];
                console.log(`🔍 Fetching CLOB price for token ${tokenId}...`);
                const price = await getCLOBPrice(tokenId);

                if (price !== null) {
                    console.log(`✅ Success: CLOB price fetched: $${price}`);
                } else {
                    console.log("⚠️ Info: CLOB price returned null (could be rate-limited or unavailable).");
                }
            } else {
                console.log("ℹ️ No CLOB IDs for sample market, skipping pricing test.");
            }
        }

        console.log("\n✨ STABILITY VERIFICATION COMPLETE. No gross errors detected.");

    } catch (error) {
        console.error("\n❌ VERIFICATION FAILED:", error);
    }
}

runVerificationScan();
