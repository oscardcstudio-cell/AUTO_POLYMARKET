// Test Polymarket Data API endpoints
async function test() {
    // 1. Get 100 recent trades and find active wallets
    console.log('=== FETCHING 100 RECENT TRADES ===\n');
    const tradesRes = await fetch('https://data-api.polymarket.com/trades?limit=100');
    const trades = await tradesRes.json();

    // Group by wallet
    const wallets = {};
    for (const t of trades) {
        if (!wallets[t.proxyWallet]) wallets[t.proxyWallet] = { total: 0, count: 0, name: t.pseudonym, wallet: t.proxyWallet };
        wallets[t.proxyWallet].total += t.size;
        wallets[t.proxyWallet].count++;
    }
    const sorted = Object.entries(wallets).sort((a,b) => b[1].total - a[1].total);
    console.log('Most active wallets (last 100 trades):');
    sorted.slice(0, 5).forEach(([w, d]) => console.log(`  $${d.total.toFixed(0)} total, ${d.count} trades | ${d.name} | ${w.substring(0, 16)}...`));

    // 2. Track activity for the top wallet
    const topWallet = sorted[0][1].wallet;
    console.log(`\n=== ACTIVITY FOR TOP WALLET: ${topWallet.substring(0, 16)}... ===\n`);
    const actRes = await fetch(`https://data-api.polymarket.com/activity?user=${topWallet}&limit=5&type=TRADE`);
    const activity = await actRes.json();
    for (const a of activity.slice(0, 5)) {
        console.log(`  ${a.side} $${a.usdcSize?.toFixed(2) || a.size} | ${a.title?.substring(0, 50)} | ${a.outcome}`);
    }

    // 3. Try getting larger trades with bigger limit
    console.log('\n=== SCANNING FOR WHALE TRADES ===\n');
    const bigRes = await fetch('https://data-api.polymarket.com/trades?limit=500');
    const bigTrades = await bigRes.json();
    const whales = bigTrades.filter(t => t.size >= 500).sort((a, b) => b.size - a.size);
    console.log(`Found ${whales.length} trades >= $500 in last ${bigTrades.length} trades`);
    whales.slice(0, 10).forEach(t =>
        console.log(`  $${t.size.toFixed(0)} ${t.side} | ${t.title?.substring(0, 50)} | ${t.pseudonym}`)
    );

    // 4. Try conditionId-specific trades (market-level whale tracking)
    if (trades[0]?.conditionId) {
        const mktId = trades[0].conditionId;
        console.log(`\n=== MARKET-LEVEL TRADES: ${trades[0].title?.substring(0, 40)} ===\n`);
        const mktRes = await fetch(`https://data-api.polymarket.com/trades?market=${mktId}&limit=10`);
        const mktTrades = await mktRes.json();
        for (const t of mktTrades.slice(0, 5)) {
            console.log(`  ${t.side} $${t.size.toFixed(2)} @ ${t.price} | ${t.pseudonym}`);
        }
    }

    console.log('\n=== DONE ===');
}

test().catch(e => console.error('Test failed:', e.message));
