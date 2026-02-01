
async function testPolymarket() {
    console.log("Testing Polymarket API...");
    try {
        const response = await fetch('https://gamma-api.polymarket.com/markets?limit=5');
        const markets = await response.json();
        console.log("Response type:", typeof markets, "IsArray:", Array.isArray(markets));
        if (Array.isArray(markets)) {
            console.log("Found", markets.length, "markets.");
            if (markets.length > 0) {
                const m = markets[0];
                console.log("Market[0] keys:", Object.keys(m));
                console.log("Question:", m.question);
                console.log("Outcome Prices:", m.outcomePrices);
                console.log("Type of Outcome Prices:", typeof m.outcomePrices);
            }
        } else {
            console.log("Response:", JSON.stringify(markets).substring(0, 500));
        }
    } catch (error) {
        console.error("Polymarket test failed:", error.message);
    }
}

testPolymarket();
