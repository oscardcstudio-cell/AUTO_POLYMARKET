/**
 * TEST GAMMA TO CLOB MAPPING
 * Discover how to map Gamma API markets to CLOB token IDs
 */

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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    ...options.headers
                }
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            const delay = Math.pow(2, attempt - 1) * 1000;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

async function exploreCLOBStructure() {
    console.log('🔍 Exploring CLOB API structure...\n');

    // 1. Get a market from Gamma API
    console.log('📊 Fetching market from Gamma API...');
    try {
        const gammaResponse = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1');
        const gammaMarkets = await gammaResponse.json();

        if (gammaMarkets && gammaMarkets.length > 0) {
            const market = gammaMarkets[0];
            console.log('✅ Sample Gamma Market:');
            console.log('   ID:', market.id);
            console.log('   Question:', market.question.substring(0, 60));
            console.log('   Condition ID:', market.conditionId || market.condition_id || 'N/A');
            console.log('   Market Slug:', market.marketSlug || market.market_slug || 'N/A');
            console.log('   Tokens:', market.tokens ? market.tokens.length : 'N/A');

            if (market.tokens && market.tokens.length > 0) {
                console.log('   Token IDs:');
                market.tokens.forEach((token, i) => {
                    console.log(`     [${i}] ${token.token_id || token.tokenId || JSON.stringify(token)}`);
                });
            }

            console.log('\n   Full market keys:', Object.keys(market).join(', '));
            console.log('');
        }
    } catch (error) {
        console.error('❌ Gamma fetch error:', error.message);
    }

    // 2. Try to get CLOB markets
    console.log('📖 Fetching from CLOB /markets...');
    try {
        const clobResponse = await fetchWithRetry('https://clob.polymarket.com/markets');
        const clobMarkets = await clobResponse.json();

        if (Array.isArray(clobMarkets)) {
            console.log(`✅ CLOB returned ${clobMarkets.length} markets`);
            if (clobMarkets.length > 0) {
                const market = clobMarkets[0];
                console.log('   Sample CLOB Market:');
                console.log('   Keys:', Object.keys(market).join(', '));
                console.log('   Full structure:', JSON.stringify(market, null, 2).substring(0, 500));
            }
        } else {
            console.log('⚠️  CLOB /markets returned:', typeof clobMarkets);
            console.log('   Structure:', JSON.stringify(clobMarkets).substring(0, 300));
        }
    } catch (error) {
        console.error('❌ CLOB markets error:', error.message);
    }

    // 3. Try different CLOB endpoints without parameters
    console.log('\n🔬 Testing CLOB endpoints...');

    const endpoints = [
        '/markets',
        '/sampling-markets',
        '/simplified-markets'
    ];

    for (const endpoint of endpoints) {
        try {
            const response = await fetchWithRetry(`https://clob.polymarket.com${endpoint}`);
            console.log(`   ${endpoint}: ${response.status} ${response.statusText}`);

            if (response.ok) {
                const data = await response.json();
                console.log(`     Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
                if (Array.isArray(data)) {
                    console.log(`     Count: ${data.length}`);
                    if (data.length > 0) {
                        console.log(`     Sample keys: ${Object.keys(data[0]).slice(0, 5).join(', ')}`);
                    }
                }
            }
        } catch (error) {
            console.log(`   ${endpoint}: ERROR - ${error.message}`);
        }
    }
}

exploreCLOBStructure().catch(error => {
    console.error('💥 Exploration crashed:', error);
});
