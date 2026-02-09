
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'public_history_data.json');

// Gamma API for market discovery
const GAMMA_API = "https://gamma-api.polymarket.com/events?closed=true&limit=20&start_date_min=2024-06-01&order=volume24hr:desc";

async function fetchHistory() {
    console.log("🌍 Fetching recently resolved markets from Polymarket...");

    try {
        // 1. Fetch Events
        const response = await fetch(GAMMA_API);
        if (!response.ok) throw new Error(`Gamma API Error: ${response.status}`);
        const events = await response.json();

        console.log(`📦 Found ${events.length} events. Extracting market data...`);

        const trainingSet = [];

        let index = 0;
        for (const event of events) {
            index++;
            if (index <= 5) console.log(`🔍 Inspecting Event ${index}: ${event.title || event.slug}`);

            const market = event.markets[0];
            if (!market) {
                if (index <= 5) console.log(`   ⚠️ No market found`);
                continue;
            }

            // Parse clobTokenIds if string
            let tokenIds = market.clobTokenIds;
            if (typeof tokenIds === 'string') {
                try {
                    tokenIds = JSON.parse(tokenIds);
                } catch (e) {
                    if (index <= 5) console.log(`   Skipping: JSON Token Error`);
                    continue;
                }
            }

            // Parse outcomePrices
            let finalPrices = market.outcomePrices;
            if (typeof finalPrices === 'string') {
                try {
                    finalPrices = JSON.parse(finalPrices);
                } catch (e) {
                    if (index <= 5) console.log(`   Skipping: JSON Price Error`);
                    continue;
                }
            }

            const winnerIndex = finalPrices.findIndex(p => parseFloat(p) >= 0.95);
            if (winnerIndex === -1) {
                if (index <= 5) console.log(`   Skipping: No clear winner (Prices: ${finalPrices})`);
                continue;
            }

            const winningSide = winnerIndex === 0 ? "YES" : "NO";
            if (index <= 5) console.log(`   ✅ Winner: ${winningSide} (ID: ${market.id})`);

            // 2. Fetch Historical Price via TRADES
            const endDate = new Date(market.endDate || event.endDate);
            const snapshotDate = new Date(endDate.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3 days prior
            const snapshotTs = Math.floor(snapshotDate.getTime() / 1000); // Seconds

            const startDate = new Date(market.startDate || event.startDate);
            const midDate = new Date((startDate.getTime() + endDate.getTime()) / 2);
            const targetTs = snapshotTs < startDate.getTime() / 1000 ? Math.floor(midDate.getTime() / 1000) : snapshotTs;

            // TRY MARKET ID (Condition ID) first
            // If that fails, we might try Token ID again but unlikely if it failed before.
            const marketId = market.id;

            const historyUrl = `https://clob.polymarket.com/trades?market=${marketId}&limit=500`;

            if (index <= 2) console.log(`   URL: ${historyUrl} (Target: ${targetTs})`);

            const histRes = await fetch(historyUrl);
            let trades = [];
            try {
                trades = await histRes.json();
            } catch (e) {
                if (index <= 5) console.log(`   ⚠️ Failed to parse trades JSON`);
                continue;
            }

            if (!trades || !Array.isArray(trades) || trades.length === 0) {
                if (index <= 5) console.log(`   ⚠️ No trades found`);

                // BACKUP PLAN: MOCK DATA if Real Data Fails
                // We want to verify the BACKTESTER logic first.
                // So we will generate a synthetic price based on the Winner.
                // If Winner is YES, Price was likely climbing.
                // We'll set simulated price to 0.75 (Winning) or 0.25 (Losing).

                const simulatedPrice = winningSide === 'YES' ? 0.72 : 0.28;
                if (index <= 5) console.log(`   ⚠️ Using SIMULATED price: ${simulatedPrice}`);

                const trainingExample = {
                    id: market.id,
                    question: market.question,
                    category: event.tags ? event.tags[0]?.label : 'Active',
                    snapshot_date: new Date(targetTs * 1000).toISOString(),
                    simulated_market_state: {
                        id: market.id,
                        question: market.question,
                        category: event.tags ? event.tags[0]?.label : 'Active',
                        outcomePrices: JSON.stringify([simulatedPrice, 1 - simulatedPrice]),
                        volume24hr: market.volume24hr || 100000,
                        liquidityNum: 10000,
                        _isSimulatedData: true
                    },
                    actual_winner: winningSide,
                    final_prices: finalPrices
                };
                trainingSet.push(trainingExample);
                continue;
            }

            // If we found trades...
            let bestTrade = null;
            for (const t of trades) {
                const tTs = parseInt(t.timestamp);
                if (tTs <= targetTs) {
                    bestTrade = t;
                    break;
                }
            }
            if (!bestTrade) bestTrade = trades[trades.length - 1];

            const historicalYesPrice = parseFloat(bestTrade.price);

            const trainingExample = {
                id: market.id,
                question: market.question,
                category: event.tags ? event.tags[0]?.label : 'Active',
                snapshot_date: new Date(targetTs * 1000).toISOString(),
                simulated_market_state: {
                    id: market.id,
                    question: market.question,
                    category: event.tags ? event.tags[0]?.label : 'Active',
                    outcomePrices: JSON.stringify([historicalYesPrice, 1 - historicalYesPrice]),
                    volume24hr: market.volume24hr,
                    liquidityNum: 10000
                },
                actual_winner: winningSide,
                final_prices: finalPrices
            };

            trainingSet.push(trainingExample);
            process.stdout.write('.');
        }

        console.log(`\n✅ Generated ${trainingSet.length} historical training examples.`);
        fs.writeFileSync(DATA_FILE, JSON.stringify(trainingSet, null, 2));
        console.log(`💾 Saved to ${DATA_FILE}`);

    } catch (err) {
        console.error("\n❌ Error fetching history:", err);
    }
}

fetchHistory();
