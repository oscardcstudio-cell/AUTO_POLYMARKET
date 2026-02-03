
// Mock CLOB API functions for debugging
const CLOB_BASE_URL = 'https://clob.polymarket.com';

async function fetchWithRetry(url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(response.statusText);
    return response;
}

async function getCLOBOrderBook(tokenId) {
    try {
        const url = `${CLOB_BASE_URL}/book?token_id=${tokenId}`;
        const response = await fetchWithRetry(url);
        return await response.json();
    } catch (e) {
        console.error("Book error:", e.message);
        return null;
    }
}

function analyzeSpread(orderBook) {
    if (!orderBook || !orderBook.bids || !orderBook.asks) return null;
    const bids = orderBook.bids;
    const asks = orderBook.asks;
    if (bids.length === 0 || asks.length === 0) return null;

    const bestBid = parseFloat(bids[0].price);
    const bestAsk = parseFloat(asks[0].price);
    return { bestBid, bestAsk };
}

async function debugSeahawksCLOB() {
    const marketId = "540234"; // Seahawks
    console.log(`Getting CLOB data for Market ${marketId}...`);

    // 1. Get Token IDs
    const mRes = await fetchWithRetry(`https://gamma-api.polymarket.com/markets/${marketId}`);
    const market = await mRes.json();

    let tokenIds = market.clobTokenIds;
    if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds);

    console.log("Token IDs:", tokenIds);

    // 2. Check Prices for BOTH tokens
    for (let i = 0; i < tokenIds.length; i++) {
        const tid = tokenIds[i];
        const side = i === 0 ? "YES" : "NO";
        console.log(`\n--- Checking Token [${side}] (${tid}) ---`);

        const book = await getCLOBOrderBook(tid);
        if (book) {
            const spread = analyzeSpread(book);
            console.log("Order Book Spread:", spread);
            if (spread) {
                console.log(`Buy Price (Ask): ${spread.bestAsk}`);
                console.log(`Sell Price (Bid): ${spread.bestBid}`);
            }
        } else {
            console.log("No Order Book found.");
        }
    }
}

debugSeahawksCLOB();
