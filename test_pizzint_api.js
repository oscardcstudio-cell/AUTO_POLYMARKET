

async function testApi() {
    console.log("Testing PizzINT API endpoint...");
    try {
        const response = await fetch('https://www.pizzint.watch/api/dashboard-data', {
            headers: { 'Referer': 'https://www.pizzint.watch/' }
        });

        console.log("Status:", response.status);
        if (response.ok) {
            const data = await response.json();
            console.log("Keys found:", Object.keys(data));
            console.log("Success field:", data.success);
            console.log("Example data - Index:", data.overall_index, "Defcon:", data.defcon_level);
        } else {
            const text = await response.text();
            console.log("Response text:", text.substring(0, 500));
        }
    } catch (error) {
        console.error("Fetch failed:", error.message);
    }
}

testApi();
