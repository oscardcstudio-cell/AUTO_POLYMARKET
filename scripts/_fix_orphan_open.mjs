/**
 * Fix orphaned OPEN trades in Supabase that are actually closed locally.
 * Compares Supabase OPEN trades with live bot state to find mismatches.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Step 1: Get all OPEN trades from Supabase
const { data: openTrades, error } = await sb.from('trades').select('*').eq('status', 'OPEN').order('created_at', { ascending: false });
if (error) { console.error('ERR:', error.message); process.exit(1); }

console.log(`Found ${openTrades.length} OPEN trades in Supabase\n`);

// Step 2: Get live bot state to know which trades are really still active
let activeTrades = [];
try {
    const res = await fetch('https://autopolymarket-production.up.railway.app/api/bot-data');
    const botData = await res.json();
    activeTrades = botData.activeTrades || [];
    console.log(`Live bot has ${activeTrades.length} active trades\n`);
} catch (e) {
    console.error('Cannot reach live bot:', e.message);
    console.log('Falling back to market_id matching with closedTrades from Supabase...');
}

// Step 3: Find orphans (OPEN in Supabase but NOT in live bot)
const activeMarketIds = new Set(activeTrades.map(t => t.marketId));
const orphans = openTrades.filter(t => !activeMarketIds.has(t.market_id));

console.log(`=== ORPHANED TRADES (${orphans.length}) ===`);
orphans.forEach(t => {
    console.log(`  ${t.id.substring(0, 8)} | ${t.created_at?.substring(0, 16)} | ${t.strategy} | ${t.side} | $${t.amount?.toFixed(2)} | ${t.question?.substring(0, 45)}`);
});

if (orphans.length === 0) {
    console.log('\nNo orphans found. All good!');
    process.exit(0);
}

// Step 4: Try to find matching closed trades in local closedTrades
// Match the closedTrades from the bot data to get the PnL
let closedTrades = [];
try {
    const res = await fetch('https://autopolymarket-production.up.railway.app/api/bot-data');
    const botData = await res.json();
    closedTrades = botData.closedTrades || [];
} catch (e) { /* already warned */ }

console.log(`\n=== FIXING ORPHANS ===`);

let fixed = 0;
for (const orphan of orphans) {
    // Try to find matching closed trade in local state
    const localMatch = closedTrades.find(ct =>
        ct.marketId === orphan.market_id &&
        Math.abs((ct.entryPrice || 0) - (orphan.entry_price || 0)) < 0.01
    );

    const updateData = {
        status: 'CLOSED',
        exit_price: localMatch?.exitPrice || orphan.entry_price, // Fallback to entry if no exit found
        pnl: localMatch?.pnl || localMatch?.profit || 0,
        pnl_percent: localMatch?.pnlPercent || 0,
    };

    console.log(`  Fixing ${orphan.id.substring(0, 8)}: ${orphan.question?.substring(0, 35)}... → CLOSED (PnL: $${updateData.pnl.toFixed(2)})`);

    const { error: updateErr } = await sb
        .from('trades')
        .update(updateData)
        .eq('id', orphan.id);

    if (updateErr) {
        console.error(`    ERROR: ${updateErr.message}`);
    } else {
        fixed++;
    }
}

console.log(`\nDone: ${fixed}/${orphans.length} trades fixed`);

// Verify
const { data: remaining } = await sb.from('trades').select('id').eq('status', 'OPEN');
console.log(`Remaining OPEN trades in Supabase: ${remaining?.length || '?'}`);
