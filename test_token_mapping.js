/**
 * TEST GAMMA TO CLOB TOKEN MAPPING
 * Test how to properly use clobTokenIds from Gamma API
 */

import {
    getCLOBOrderBook,
    getCLOBPrice,
    getBestExecutionPrice,
} from './clob_api.js';

async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeout = 20000;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    ...options.headers
                }
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
        }
    }
}

async function testTokenMapping() {
    console.log('🧪 Testing CLOB Token ID Mapping\n');

    // 1. Get a market from Gamma with clobTokenIds
    console.log('📊 Fetching active market from Gamma...');
    const gammaResponse = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10');
    const markets = await gammaResponse.json();

    if (!markets || markets.length === 0) {
        console.log('❌ No markets found');
        return;
    }

    // Find a market with clobTokenIds
    const marketWithClob = markets.find(m => m.clobTokenIds && m.clobTokenIds.length > 0);

    if (!marketWithClob) {
        console.log('❌ No markets with clobTokenIds found');
        console.log('   Available markets:', markets.length);
        return;
    }

    console.log('✅ Found market with CLOB tokens');
    console.log('   Question:', marketWithClob.question.substring(0, 60));
    console.log('   Market ID:', marketWithClob.id);

    // clobTokenIds is actually a JSON string, not an array
    let clobTokens = marketWithClob.clobTokenIds;
    if (typeof clobTokens === 'string') {
        clobTokens = JSON.parse(clobTokens);
    }

    console.log('   CLOB Token IDs (YES, NO):');
    console.log('     YES:', clobTokens[0]);
    console.log('     NO:', clobTokens[1]);
    console.log('   Outcome Prices:', marketWithClob.outcomePrices);
    console.log('');

    // 2. Test each CLOB token
    const tokenId = clobTokens[0]; // Test YES token (first element)
    console.log(`🔍 Testing YES Token ID: ${tokenId}\n`);

    // Test Order Book
    console.log('📖 Testing Order Book...');
    const orderBook = await getCLOBOrderBook(tokenId);
    if (orderBook) {
        console.log('✅ Order book retrieved');
        console.log('   Bids:', orderBook.bids?.length || 0);
        console.log('   Asks:', orderBook.asks?.length || 0);
        if (orderBook.bids && orderBook.bids.length > 0) {
            console.log('   Best Bid:', orderBook.bids[0].price, '(size:', orderBook.bids[0].size, ')');
        }
        if (orderBook.asks && orderBook.asks.length > 0) {
            console.log('   Best Ask:', orderBook.asks[0].price, '(size:', orderBook.asks[0].size, ')');
        }
    } else {
        console.log('❌ Order book failed');
    }
    console.log('');

    // Test Price
    console.log('💰 Testing Price...');
    const price = await getCLOBPrice(tokenId);
    if (price) {
        console.log('✅ Price:', price);
    } else {
        console.log('❌ Price failed');
    }
    console.log('');

    // Test Execution Price
    console.log('🎯 Testing Execution Price...');
    const execPrice = await getBestExecutionPrice(tokenId, 'buy');
    if (execPrice) {
        console.log('✅ Best execution price (BUY):', execPrice.price);
        console.log('   Mid Price:', execPrice.midPrice);
        console.log('   Spread:', execPrice.spreadPercent + '%');
        console.log('   Liquidity:', execPrice.liquidity);
        if (execPrice.warning) {
            console.log('   ⚠️ ', execPrice.warning);
        }
    } else {
        console.log('❌ Execution price failed');
    }
    console.log('');

    // Compare with Gamma prices
    console.log('📊 Comparing with Gamma API prices...');
    if (marketWithClob.outcomePrices) {
        // outcomePrices can be array or JSON string
        let prices = marketWithClob.outcomePrices;
        if (typeof prices === 'string') {
            prices = JSON.parse(prices);
        }

        const gammaYesPrice = parseFloat(prices[0]);
        const gammaNoPrice = parseFloat(prices[1]);

        console.log('   Gamma YES price:', gammaYesPrice);
        console.log('   Gamma NO price:', gammaNoPrice);

        if (price && !isNaN(gammaYesPrice)) {
            const diff = Math.abs(price - gammaYesPrice);
            const diffPercent = (diff / gammaYesPrice * 100).toFixed(2);
            console.log('   Difference:', diffPercent + '%');

            if (diffPercent < 2) {
                console.log('   ✅ Prices are consistent (< 2% diff)');
            } else {
                console.log('   ⚠️  Significant price difference');
            }
        }
    }

    console.log('\n✅ Test complete!');
}

testTokenMapping().catch(error => {
    console.error('💥 Test crashed:', error);
});
