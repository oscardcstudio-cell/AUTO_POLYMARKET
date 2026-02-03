
async function verifyPrices() {
    const markets = [
        { id: "540234", name: "Seattle Seahawks", side: "YES" }, // From bot_data
        { id: "541517", name: "Christian McCaffrey", side: "NO" }, // From bot_data
        { id: "1271400", name: "Spread: Seahawks (-4.5)", side: "NO" } // From bot_data
    ];

    console.log("Verifying prices for active trades...");

    for (const m of markets) {
        try {
            console.log(`\n--- Market: ${m.name} (${m.id}) ---`);
            const url = `https://gamma-api.polymarket.com/markets/${m.id}`;
            const response = await fetch(url);
            const data = await response.json();

            console.log(`Last Trade Price: ${data.lastTradePrice}`);
            console.log(`Outcome Prices: ${JSON.stringify(data.outcomePrices)}`);

            let outcomePrices = data.outcomePrices;
            if (typeof outcomePrices === 'string') outcomePrices = JSON.parse(outcomePrices);

            if (outcomePrices) {
                const yes = parseFloat(outcomePrices[0]);
                const no = parseFloat(outcomePrices[1]);
                console.log(`YES Price: ${yes}`);
                console.log(`NO Price: ${no}`);

                const mySidePrice = m.side === 'YES' ? yes : no;
                console.log(`Price for my side (${m.side}): ${mySidePrice}`);
            }
        } catch (e) {
            console.error(e);
        }
    }
}

verifyPrices();
