// Quick test of the improved fetch wrapper

// Copy of the fetchWithRetry function
async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeout = 10000; // 10 seconds timeout

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
            const isLastAttempt = attempt === retries;

            if (isLastAttempt) {
                throw error;
            }

            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.log(`⚠️ Fetch attempt ${attempt} failed for ${url}, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

async function testImprovedFetch() {
    console.log('🧪 Testing improved fetch with retry logic...\n');

    // Test 1: Polymarket API
    console.log('Test 1: Polymarket API (multiple calls)');
    for (let i = 1; i <= 5; i++) {
        try {
            const start = Date.now();
            const response = await fetchWithRetry('https://gamma-api.polymarket.com/markets?limit=1');
            const elapsed = Date.now() - start;
            console.log(`  ✅ Call ${i}: Success (${response.status}) - ${elapsed}ms`);
        } catch (error) {
            console.log(`  ❌ Call ${i}: Failed - ${error.message}`);
        }
    }

    console.log('\nTest 2: PizzINT API (multiple calls)');
    for (let i = 1; i <= 5; i++) {
        try {
            const start = Date.now();
            const response = await fetchWithRetry('https://www.pizzint.watch/api/dashboard-data', {
                headers: { 'Referer': 'https://www.pizzint.watch/' }
            });
            const elapsed = Date.now() - start;
            console.log(`  ✅ Call ${i}: Success (${response.status}) - ${elapsed}ms`);
        } catch (error) {
            console.log(`  ❌ Call ${i}: Failed - ${error.message}`);
        }
    }

    console.log('\n✨ Test complete! If all calls succeeded, the fix is working.');
}

testImprovedFetch();
