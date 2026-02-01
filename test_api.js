async function testApi() {
    console.log("Testing pizzint.watch API with built-in fetch...");
    try {
        const response = await fetch('https://www.pizzint.watch/api/dashboard-data', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://www.pizzint.watch/'
            }
        });

        const data = await response.json();

        if (data && data.success) {
            const { overall_index, defcon_level, data_freshness } = data;
            console.log("SUCCESS!");
            console.log(`Overall Index: ${overall_index}`);
            console.log(`DEFCON Level: ${defcon_level}`);
            console.log(`Data Freshness: ${data_freshness}`);

            if (data.events && data.events.length > 0) {
                console.log(`Active Spikes: ${data.events.length}`);
            }
        } else {
            console.log("API returned failure:", data);
        }
    } catch (error) {
        console.error("API call failed:", error.message);
    }
}

testApi();
