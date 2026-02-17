/**
 * cleanup_orphan_trades.js
 * Finds trades in Supabase that are OPEN but not tracked by the bot's local state.
 * Closes them at their last known price to sync DB with reality.
 *
 * Usage: node scripts/cleanup_orphan_trades.js
 * (Run from main repo dir which has .env)
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
    console.log('=== ORPHAN TRADE CLEANUP ===\n');

    // 1. Get bot state to find what the bot considers "active"
    const { data: stateRow } = await supabase
        .from('bot_state')
        .select('state_data')
        .eq('id', 'global_state')
        .single();

    const localActiveIds = new Set(
        (stateRow?.state_data?.activeTrades || []).map(t => t.marketId)
    );

    console.log(`Bot local state tracks ${localActiveIds.size} active trades`);

    // 2. Get all OPEN trades in DB
    const { data: openTrades, error } = await supabase
        .from('trades')
        .select('*')
        .eq('status', 'OPEN');

    if (error) {
        console.error('Failed to fetch trades:', error.message);
        return;
    }

    console.log(`Supabase has ${openTrades.length} OPEN trades\n`);

    // 3. Find orphans (in DB as OPEN, but NOT in bot's active list)
    const orphans = openTrades.filter(t => !localActiveIds.has(t.market_id));

    if (orphans.length === 0) {
        console.log('No orphan trades found. DB is in sync.');
        return;
    }

    console.log(`Found ${orphans.length} orphan trades to close:\n`);

    for (const trade of orphans) {
        const entry = trade.entry_price || 0;
        // Close at entry price (assume no gain/no loss since we don't know real exit)
        const exitPrice = entry;
        const pnl = 0; // Neutral close — we don't know the actual exit

        console.log(`  Closing: ${trade.question?.substring(0, 50)}...`);
        console.log(`    Market: ${trade.market_id} | Side: ${trade.side} | Entry: ${entry}`);
        console.log(`    Amount: $${trade.amount} | Closing at entry (neutral)\n`);

        const { error: updateError } = await supabase
            .from('trades')
            .update({
                status: 'CLOSED',
                exit_price: exitPrice,
                pnl: pnl,
                pnl_percent: 0,
                metadata: {
                    ...(trade.metadata || {}),
                    closeReason: 'ORPHAN_CLEANUP: Trade not tracked by bot, closed at entry price',
                    closedAt: new Date().toISOString()
                }
            })
            .eq('id', trade.id);

        if (updateError) {
            console.error(`    ERROR: ${updateError.message}`);
        } else {
            console.log(`    OK — Closed successfully`);
        }
    }

    console.log(`\nDone. Closed ${orphans.length} orphan trades.`);

    // 4. Verify
    const { data: remainingOpen } = await supabase
        .from('trades')
        .select('id')
        .eq('status', 'OPEN');

    console.log(`Remaining OPEN trades in DB: ${remainingOpen?.length || 0}`);
}

main().catch(console.error);
