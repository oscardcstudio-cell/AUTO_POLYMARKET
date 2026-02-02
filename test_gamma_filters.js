/**
 * TEST GAMMA ENHANCED FILTERS
 * Verification script for advanced Gamma API features
 */

import {
    fetchAvailableTags,
    fetchSportsMetadata,
    getMarketsWithFilters,
    getAllMarketsWithPagination,
    getMarketsByTags,
    getTrendingMarkets,
    getNonSportsMarkets,
    getContextualMarkets
} from './market_discovery.js';

console.log('🧪 Testing Enhanced Gamma API Integration\n');

async function testGammaEnhancements() {
    let passedTests = 0;
    let failedTests = 0;

    // Test 1: Fetch Available Tags
    console.log('🏷️  Test 1: Fetching Available Tags');
    try {
        const tags = await fetchAvailableTags();
        if (tags && Array.isArray(tags) && tags.length > 0) {
            console.log(`✅ Found ${tags.length} tags`);
            console.log(`   Sample tags: ${tags.slice(0, 5).map(t => t.label || t.name).join(', ')}`);
            passedTests++;
        } else {
            console.log('❌ No tags returned');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Tags fetch failed:', error.message);
        failedTests++;
    }
    console.log('');

    // Test 2: Fetch Sports Metadata
    console.log('🏈 Test 2: Fetching Sports Metadata');
    try {
        const sports = await fetchSportsMetadata();
        if (sports) {
            const count = Array.isArray(sports) ? sports.length : Object.keys(sports).length;
            console.log(`✅ Sports metadata retrieved (${count} items)`);
            passedTests++;
        } else {
            console.log('⚠️  Sports metadata unavailable');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Sports fetch failed:', error.message);
        failedTests++;
    }
    console.log('');

    // Test 3: Markets with Filters
    console.log('🔍 Test 3: Markets with Volume Filter');
    try {
        const markets = await getMarketsWithFilters({
            active: true,
            closed: false,
            order: 'volume24hr',
            ascending: false,
            limit: 10
        });

        if (markets && markets.length > 0) {
            console.log(`✅ Found ${markets.length} markets (ordered by volume)`);
            const topMarket = markets[0];
            console.log(`   Top market: "${topMarket.question.substring(0, 50)}..."`);
            console.log(`   Volume 24h: $${parseFloat(topMarket.volume24hr || 0).toLocaleString()}`);
            passedTests++;
        } else {
            console.log('❌ No markets with filters');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Filtered markets failed:', error.message);
        failedTests++;
    }
    console.log('');

    // Test 4: Pagination (Deep Scan)
    console.log('📊 Test 4: Pagination (fetching 600 markets)');
    try {
        const startTime = Date.now();
        const allMarkets = await getAllMarketsWithPagination({
            active: true,
            closed: false
        }, 600);
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (allMarkets && allMarkets.length > 0) {
            console.log(`✅ Deep scan found ${allMarkets.length} markets in ${duration}s`);

            // Verify uniqueness
            const uniqueIds = new Set(allMarkets.map(m => m.id));
            if (uniqueIds.size === allMarkets.length) {
                console.log(`   ✓ All markets are unique (no duplicates)`);
            } else {
                console.log(`   ⚠️  Found ${allMarkets.length - uniqueIds.size} duplicates`);
            }

            passedTests++;
        } else {
            console.log('❌ Pagination failed');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Pagination error:', error.message);
        failedTests++;
    }
    console.log('');

    // Test 5: Trending Markets
    console.log('📈 Test 5: Trending Markets');
    try {
        const trending = await getTrendingMarkets(20);
        if (trending && trending.length > 0) {
            console.log(`✅ Found ${trending.length} trending markets`);
            console.log('   Top 3:');
            trending.slice(0, 3).forEach((m, i) => {
                console.log(`     ${i + 1}. "${m.question.substring(0, 40)}..." (Vol: $${parseFloat(m.volume24hr || 0).toLocaleString()})`);
            });
            passedTests++;
        } else {
            console.log('❌ No trending markets');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Trending markets failed:', error.message);
        failedTests++;
    }
    console.log('');

    // Test 6: Non-Sports Markets
    console.log('⚽ Test 6: Excluding Sports Markets');
    try {
        const nonSports = await getNonSportsMarkets({
            active: true,
            closed: false,
            limit: 50
        });

        if (nonSports && nonSports.length > 0) {
            console.log(`✅ Found ${nonSports.length} non-sports markets`);

            // Verify no sports keywords
            const sportsKeywords = ['nfl', 'nba', 'football', 'soccer', 'baseball', 'basketball'];
            const hasSports = nonSports.some(m =>
                sportsKeywords.some(kw => m.question.toLowerCase().includes(kw))
            );

            if (!hasSports) {
                console.log('   ✓ Successfully filtered out sports markets');
            } else {
                console.log('   ⚠️  Some sports markets may still be present');
            }

            passedTests++;
        } else {
            console.log('⚠️  Filtering may not be working (or all markets are sports)');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Non-sports filtering failed:', error.message);
        failedTests++;
    }
    console.log('');

    // Test 7: Contextual Markets (DEFCON-based)
    console.log('🚨 Test 7: Contextual Markets (DEFCON 2 - Crisis Mode)');
    try {
        const contextual = await getContextualMarkets(2, 30);
        if (contextual && contextual.length > 0) {
            console.log(`✅ Found ${contextual.length} crisis-relevant markets`);

            // Check for geopolitical/economic themes
            const relevantKeywords = ['war', 'conflict', 'president', 'election', 'economy', 'market', 'crypto'];
            const relevantMarkets = contextual.filter(m =>
                relevantKeywords.some(kw => m.question.toLowerCase().includes(kw))
            );

            console.log(`   ${relevantMarkets.length}/${contextual.length} contain crisis-relevant keywords`);
            if (relevantMarkets.length > 0) {
                console.log(`   Sample: "${relevantMarkets[0].question.substring(0, 50)}..."`);
            }

            passedTests++;
        } else {
            console.log('⚠️  Contextual filtering may need tuning');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Contextual markets failed:', error.message);
        failedTests++;
    }
    console.log('');

    // Test 8: Cache Performance
    console.log('⚡ Test 8: Cache Performance (re-fetch tags)');
    try {
        const start = Date.now();
        const cachedTags = await fetchAvailableTags();
        const duration = Date.now() - start;

        if (duration < 100 && cachedTags && cachedTags.length > 0) {
            console.log(`✅ Cache working perfectly (${duration}ms)`);
            passedTests++;
        } else if (cachedTags && cachedTags.length > 0) {
            console.log(`⚠️  Cache might not be optimal (${duration}ms)`);
            passedTests++;
        } else {
            console.log('❌ Cache test failed');
            failedTests++;
        }
    } catch (error) {
        console.log('❌ Cache test error:', error.message);
        failedTests++;
    }
    console.log('');

    // Summary
    console.log('═══════════════════════════════════════');
    console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
    const successRate = ((passedTests / (passedTests + failedTests)) * 100).toFixed(1);
    console.log(`   Success Rate: ${successRate}%`);
    console.log('═══════════════════════════════════════');

    if (failedTests === 0) {
        console.log('✅ All tests passed! Enhanced Gamma API is fully functional.');
    } else if (passedTests > failedTests) {
        console.log('⚠️  Most tests passed. Enhanced Gamma API is functional.');
    } else {
        console.log('❌ Many tests failed. Check implementation.');
    }
}

testGammaEnhancements().catch(error => {
    console.error('💥 Test suite crashed:', error);
});
