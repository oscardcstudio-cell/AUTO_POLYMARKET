
import fetch from 'node-fetch';

async function checkGammaStructure() {
    try {
        console.log("Fetching markets from Gamma API...");
        const response = await fetch('https://gamma-api.polymarket.com/markets?limit=1&active=true');
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            const market = data[0];
            console.log("Market Keys:", Object.keys(market));
            console.log("clobTokenIds:", market.clobTokenIds);
            console.log("clob_token_ids (snake_case):", market.clobTokenIds ? "N/A" : market['clob_token_ids']);
            console.log("tokens:", market.tokens);
        } else {
            console.log("No markets found or invalid response.");
        }
    } catch (error) {
        console.error("Error fetching:", error);
    }
}

checkGammaStructure();
