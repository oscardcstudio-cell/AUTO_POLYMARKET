// Test fetch with different configurations
async function testFetch() {
    console.log('Testing Polymarket API...');

    try {
        const response = await fetch('https://gamma-api.polymarket.com/markets?limit=1', {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        console.log('✅ Polymarket API Status:', response.status);
        const data = await response.json();
        console.log('✅ Data received:', data.length > 0 ? 'Yes' : 'No');
    } catch (error) {
        console.error('❌ Polymarket Error:', error.message);
        console.error('Error details:', error);
    }

    console.log('\nTesting PizzINT API...');
    try {
        const response = await fetch('https://www.pizzint.watch/api/dashboard-data', {
            headers: {
                'Referer': 'https://www.pizzint.watch/',
                'User-Agent': 'Mozilla/5.0'
            }
        });
        console.log('✅ PizzINT API Status:', response.status);
        const data = await response.json();
        console.log('✅ Data received:', data.success ? 'Yes' : 'No');
    } catch (error) {
        console.error('❌ PizzINT Error:', error.message);
        console.error('Error details:', error);
    }
}

testFetch();
