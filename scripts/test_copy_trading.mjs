/**
 * Test the copy trading module independently.
 * Run: node scripts/test_copy_trading.mjs
 */

import { fetchLeaderboard, fetchWalletPositions, clearWalletCaches } from '../src/api/wallet_tracker.js';

async function main() {
    console.log('=== COPY TRADING MODULE TEST ===\n');

    // 1. Test Leaderboard
    console.log('1. Fetching leaderboard (top 10 by PnL this week)...');
    const traders = await fetchLeaderboard('OVERALL', 'WEEK', 10);

    if (traders.length === 0) {
        console.log('   ❌ No traders returned. API might be down or rate-limited.\n');
    } else {
        console.log(`   ✅ Got ${traders.length} traders:\n`);
        for (const t of traders.slice(0, 5)) {
            console.log(`   #${t.rank} ${t.username} | PnL: $${Math.round(t.pnl)} | Vol: $${Math.round(t.volume)}`);
        }
        console.log('');

        // 2. Test Wallet Positions (use #1 trader)
        const topWallet = traders[0].wallet;
        console.log(`2. Fetching positions for #1 trader (${traders[0].username}: ${topWallet.substring(0, 10)}...)...`);
        const positions = await fetchWalletPositions(topWallet);

        if (positions.length === 0) {
            console.log('   ❌ No positions returned.\n');
        } else {
            console.log(`   ✅ Got ${positions.length} positions:\n`);
            for (const p of positions.slice(0, 5)) {
                const pnlEmoji = p.cashPnL >= 0 ? '🟢' : '🔴';
                console.log(`   ${pnlEmoji} ${p.outcome} on "${(p.title || 'Unknown').substring(0, 50)}..." | Size: ${Math.round(p.size)} shares | PnL: $${Math.round(p.cashPnL)} (${p.percentPnL?.toFixed(1)}%)`);
            }
        }
    }

    console.log('\n=== TEST COMPLETE ===');
}

main().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
