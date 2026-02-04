
// import fetch from 'node-fetch'; // Built-in in Node 18+

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
    } catch (e) {
        if (retries > 0) return fetchWithRetry(url, options, retries - 1);
        throw e;
    }
}

// --- MOCK STATE ---
let botState = {
    capital: 1000.00,
    activeTrades: []
};

// --- LOGIC TO TEST ---
async function getRealMarketPrice(marketId, side) {
    console.log(`\n🔍 Fetching REAL PRICE for Market ${marketId} (${side})...`);

    // 1. Fetch Gamma Data
    const response = await fetchWithRetry(`https://gamma-api.polymarket.com/markets/${marketId}`);
    const market = await response.json();

    console.log(`   > Market Question: "${market.question}"`);
    console.log(`   > Outcome Prices (Raw):`, market.outcomePrices);
    console.log(`   > Best Bid/Ask: ${market.bestBid} / ${market.bestAsk}`);

    let price = null;
    let source = 'NONE';

    // STRICT CHECK: We want the executions price (Best Ask for Buy, Best Bid for Sell)
    // Simulating a BUY here
    const bestAsk = parseFloat(market.bestAsk || 0);

    if (bestAsk > 0) {
        price = bestAsk;
        source = 'CLOB_BEST_ASK';
    } else if (market.outcomePrices) {
        // Fallback to outcome array if CLOB is empty (but still real data)
        const prices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : market.outcomePrices;
        price = side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
        source = 'GAMMA_OUTCOME_PRICE';
    }

    if (price === null || price === 0) {
        console.error('   ❌ NO VALID PRICE FOUND! (Would have failed safely)');
        return null;
    }

    console.log(`   ✅ Price Found: ${price} (Source: ${source})`);

    // Check for "Invented" fallback logic (e.g. 0.5)
    if (price === 0.5 && source === 'GAMMA_OUTCOME_PRICE') {
        console.warn('   ⚠️ WARNING: Price is exactly 0.5. Check if this is a coincidence or a default.');
    }

    return price;
}

// --- TEST SCENARIO ---
async function runTest() {
    console.log('🏁 STARTING STRICT PRICE & WALLET TEST');
    console.log(`Initial Capital: $${botState.capital.toFixed(2)}`);

    // 1. Pick a popular market (High Liquidity)
    const trends = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1&ordering=-volume24hr');
    const markets = await trends.json();
    const market = markets[0];

    // 2. GET PRICE
    const side = 'YES';
    const price = await getRealMarketPrice(market.id, side);

    if (!price) {
        console.error('Test Aborted: Could not get a price.');
        return;
    }

    // 3. SIMULATE BUY
    const tradeSize = 100.00;
    const fees = tradeSize * 0.001; // 0.1% simulated fee
    const cost = tradeSize;

    const shares = (tradeSize - fees) / price;

    console.log(`\n💸 EXECUTING BUY: $${tradeSize} of ${side}`);
    console.log(`   > Price: ${price}`);
    console.log(`   > Fees: $${fees.toFixed(4)}`);
    console.log(`   > Shares: ${shares.toFixed(4)}`);

    // UPDATE WALLET
    const initialCaptial = botState.capital;
    botState.capital -= cost;

    console.log(`\n💰 WALLET UPDATE:`);
    console.log(`   > Before: $${initialCaptial.toFixed(2)}`);
    console.log(`   > After:  $${botState.capital.toFixed(2)}`);

    if (botState.capital === initialCaptial - cost) {
        console.log('   ✅ Wallet decremented correctly.');
    } else {
        console.error('   ❌ Wallet Logic Error!');
    }

    botState.activeTrades.push({
        id: 'TEST_TRADE',
        marketId: market.id,
        side: side,
        shares: shares,
        entryPrice: price,
        cost: cost
    });

    // 4. SIMULATE SELL (Instant)
    console.log(`\n🔄 SIMULATING SELL (Closing Position)...`);
    // Assume price moved slightly
    const exitPrice = price * 1.05; // 5% gain simulation
    console.log(`   > Exit Price (Simulated +5%): ${exitPrice.toFixed(4)}`);

    const rawReturn = shares * exitPrice;
    const exitFees = rawReturn * 0.001;
    const netReturn = rawReturn - exitFees;

    console.log(`   > Gross Return: $${rawReturn.toFixed(2)}`);
    console.log(`   > Exit Fees: $${exitFees.toFixed(2)}`);
    console.log(`   > Net Return: $${netReturn.toFixed(2)}`);

    // UPDATE WALLET
    const capitalBeforeSell = botState.capital;
    botState.capital += netReturn;

    console.log(`\n💰 WALLET UPDATE (Post-Sell):`);
    console.log(`   > Before: $${capitalBeforeSell.toFixed(2)}`);
    console.log(`   > After:  $${botState.capital.toFixed(2)}`);

    const finalProfit = botState.capital - initialCaptial;
    console.log(`\n📊 FINAL RESULT: Profit of $${finalProfit.toFixed(2)}`);

}

runTest();
