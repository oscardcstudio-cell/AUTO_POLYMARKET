/**
 * Test CLOB API endpoints live against real active trades
 */
import { readFileSync } from 'fs';

const CLOB_BASE = 'https://clob.polymarket.com';

async function testEndpoint(name, url) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { json = text; }
        console.log(`  ${res.ok ? '✅' : '❌'} ${name}: status=${res.status}`, JSON.stringify(json).substring(0, 120));
        return { ok: res.ok, status: res.status, data: json };
    } catch (e) {
        console.log(`  💥 ${name}: ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// Load bot data to get real token IDs
const botData = JSON.parse(readFileSync('bot_data.json', 'utf-8'));
const trades = botData.activeTrades || [];

console.log(`\n🔍 Testing CLOB API on ${trades.length} active trades\n`);

// Test health first
console.log('=== HEALTH CHECK ===');
await testEndpoint('/ok', `${CLOB_BASE}/ok`);
await testEndpoint('/server-time', `${CLOB_BASE}/server-time`);

for (const trade of trades.slice(0, 4)) {
    let tokenIds = trade.clobTokenIds;
    if (typeof tokenIds === 'string') {
        try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = null; }
    }

    const tokenId = Array.isArray(tokenIds) && tokenIds.length >= 2
        ? (trade.side === 'YES' ? tokenIds[0] : tokenIds[1])
        : null;

    console.log(`\n=== ${trade.question?.substring(0, 50)} (${trade.side}) ===`);
    console.log(`  Token ID: ${tokenId ? tokenId.substring(0, 40) + '...' : 'MISSING'}`);

    if (!tokenId) {
        console.log('  ⚠️ No token ID, skipping');
        continue;
    }

    // Test all 3 pricing endpoints
    await testEndpoint('/midpoint', `${CLOB_BASE}/midpoint?token_id=${tokenId}`);
    await testEndpoint('/price (NO side)', `${CLOB_BASE}/price?token_id=${tokenId}`);
    await testEndpoint('/price (side=BUY)', `${CLOB_BASE}/price?token_id=${tokenId}&side=BUY`);
    await testEndpoint('/price (side=SELL)', `${CLOB_BASE}/price?token_id=${tokenId}&side=SELL`);
}

console.log('\n✅ Done');
