/**
 * TEST CLOB API - Verification script for CLOB API integration
 */

import {
    getCLOBOrderBook,
    getCLOBPrice,
    getCLOBMidpoint,
    getCLOBMarkets,
    analyzeSpread,
    getBestExecutionPrice,
    checkCLOBHealth
} from './clob_api.js';

console.log('🧪 Testing CLOB API Integration...\n');

async function testCLOBAPI() {
    let passedTests = 0;
    let failedTests = 0;

    // Test 1: Health Check
    console.log('📡 Test 1: CLOB Health Check');
    try {
        const isHealthy = await checkCLOBHealth();
        if (isHealthy) {
            console.log('✅ CLOB API is online\n');
            passedTests++;
        } else {
            console.log('❌ CLOB API is offline\n');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Health check failed:', error.message, '\n');
        failedTests++;
    }

    // Test 2: Get Markets
    console.log('📊 Test 2: Fetching CLOB Markets');
    let testTokenId = null;
    try {
        const markets = await getCLOBMarkets();
        if (markets && Array.isArray(markets) && markets.length > 0) {
            console.log(`✅ Found ${markets.length} markets`);
            console.log(`   Sample market:`, markets[0].condition_id || 'No condition_id');

            // Extract a token ID for further testing
            if (markets[0].tokens && markets[0].tokens.length > 0) {
                testTokenId = markets[0].tokens[0].token_id;
                console.log(`   Using token ID for tests: ${testTokenId}\n`);
                passedTests++;
            } else {
                console.log('⚠️  No token IDs found in markets\n');
                failedTests++;
            }
        } else {
            console.log('❌ No markets returned or invalid format\n');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Markets fetch failed:', error.message, '\n');
        failedTests++;
    }

    // If we don't have a token ID, use a known one from Polymarket
    if (!testTokenId) {
        console.log('⚠️  Using fallback token ID for testing\n');
        // This is a commonly active token - may need to be updated
        testTokenId = '21742633143463906290569050155826241533067272736897614950488156847949938836455';
    }

    // Test 3: Get Order Book
    console.log('📖 Test 3: Fetching Order Book');
    let orderBook = null;
    try {
        orderBook = await getCLOBOrderBook(testTokenId);
        if (orderBook && orderBook.bids && orderBook.asks) {
            console.log(`✅ Order book retrieved`);
            console.log(`   Bids: ${orderBook.bids.length}, Asks: ${orderBook.asks.length}`);
            if (orderBook.bids.length > 0) {
                console.log(`   Best Bid: ${orderBook.bids[0].price} (size: ${orderBook.bids[0].size})`);
            }
            if (orderBook.asks.length > 0) {
                console.log(`   Best Ask: ${orderBook.asks[0].price} (size: ${orderBook.asks[0].size})`);
            }
            console.log('');
            passedTests++;
        } else {
            console.log('❌ Order book invalid or empty\n');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Order book fetch failed:', error.message, '\n');
        failedTests++;
    }

    // Test 4: Analyze Spread
    if (orderBook) {
        console.log('📐 Test 4: Analyzing Spread');
        try {
            const spreadInfo = analyzeSpread(orderBook);
            if (spreadInfo) {
                console.log(`✅ Spread analysis complete`);
                console.log(`   Mid Price: ${spreadInfo.midPrice}`);
                console.log(`   Spread: ${spreadInfo.spread} (${spreadInfo.spreadPercent}%)`);
                console.log(`   Liquidity: ${spreadInfo.liquidity}`);
                if (spreadInfo.warning) {
                    console.log(`   ⚠️  ${spreadInfo.warning}`);
                }
                console.log('');
                passedTests++;
            } else {
                console.log('❌ Spread analysis failed\n');
                failedTests++;
            }
        } catch (error) {
            console.log('❌ Spread analysis error:', error.message, '\n');
            failedTests++;
        }
    }

    // Test 5: Get Price
    console.log('💰 Test 5: Fetching CLOB Price');
    try {
        const price = await getCLOBPrice(testTokenId);
        if (price !== null && price > 0 && price < 1) {
            console.log(`✅ Price retrieved: ${price}\n`);
            passedTests++;
        } else {
            console.log(`❌ Invalid price: ${price}\n`);
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Price fetch failed:', error.message, '\n');
        failedTests++;
    }

    // Test 6: Get Midpoint
    console.log('🎯 Test 6: Fetching Midpoint Price');
    try {
        const midpoint = await getCLOBMidpoint(testTokenId);
        if (midpoint !== null && midpoint > 0 && midpoint < 1) {
            console.log(`✅ Midpoint retrieved: ${midpoint}\n`);
            passedTests++;
        } else {
            console.log(`❌ Invalid midpoint: ${midpoint}\n`);
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Midpoint fetch failed:', error.message, '\n');
        failedTests++;
    }

    // Test 7: Get Best Execution Price
    console.log('🎲 Test 7: Getting Best Execution Price (BUY)');
    try {
        const execPrice = await getBestExecutionPrice(testTokenId, 'buy');
        if (execPrice) {
            console.log(`✅ Execution price calculated`);
            console.log(`   Price: ${execPrice.price} (${execPrice.source})`);
            console.log(`   Mid Price: ${execPrice.midPrice}`);
            console.log(`   Spread: ${execPrice.spreadPercent}%`);
            console.log(`   Liquidity: ${execPrice.liquidity}`);
            if (execPrice.warning) {
                console.log(`   ⚠️  ${execPrice.warning}`);
            }
            console.log('');
            passedTests++;
        } else {
            console.log('❌ Execution price failed\n');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Execution price error:', error.message, '\n');
        failedTests++;
    }

    // Test 8: Cache Test (should be instant)
    console.log('⚡ Test 8: Cache Performance');
    try {
        const start = Date.now();
        const cachedPrice = await getCLOBPrice(testTokenId);
        const duration = Date.now() - start;

        if (duration < 100) {
            console.log(`✅ Cache working (${duration}ms - should be <100ms)`);
            console.log(`   Cached price: ${cachedPrice}\n`);
            passedTests++;
        } else {
            console.log(`⚠️  Cache might not be working (${duration}ms)\n`);
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Cache test failed:', error.message, '\n');
        failedTests++;
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
    const successRate = ((passedTests / (passedTests + failedTests)) * 100).toFixed(1);
    console.log(`   Success Rate: ${successRate}%`);
    console.log('═══════════════════════════════════════');

    if (failedTests === 0) {
        console.log('✅ All tests passed! CLOB API is fully functional.');
    } else if (passedTests > failedTests) {
        console.log('⚠️  Some tests failed, but CLOB API is partially functional.');
    } else {
        console.log('❌ CLOB API is not working properly. Check your connection.');
    }
}

testCLOBAPI().catch(error => {
    console.error('💥 Test suite crashed:', error);
});
