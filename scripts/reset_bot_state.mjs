/**
 * Reset bot_state table in Supabase to match the clean trades state.
 * Run after wallet reset to sync bot_state with actual trades data.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Get the real state from trades
const { data: allTrades, error: trErr } = await supabase
    .from('trades')
    .select('*')
    .order('created_at', { ascending: true });

if (trErr) { console.error('Error fetching trades:', trErr.message); process.exit(1); }

const openTrades = allTrades.filter(t => t.status === 'OPEN');
const closedTrades = allTrades.filter(t => t.status !== 'OPEN');
const totalRealizedPnL = closedTrades.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
const activeInvested = openTrades.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
const capital = 1000 + totalRealizedPnL - activeInvested;

console.log(`Trades: ${allTrades.length} total, ${openTrades.length} OPEN, ${closedTrades.length} closed`);
console.log(`Capital: $${capital.toFixed(2)} (PnL: ${totalRealizedPnL.toFixed(2)}, Invested: ${activeInvested.toFixed(2)})`);

// Update bot_state
const cleanState = {
    capital: capital,
    startingCapital: 1000,
    totalTrades: allTrades.length,
    winningTrades: closedTrades.filter(t => parseFloat(t.pnl) > 0).length,
    losingTrades: closedTrades.filter(t => parseFloat(t.pnl) <= 0).length,
    activeTrades: [],
    closedTrades: closedTrades.slice(-50).map(t => ({
        question: t.question,
        side: t.side,
        amount: parseFloat(t.amount),
        pnl: parseFloat(t.pnl),
        status: t.status
    })),
    learningParams: { mode: 'NEUTRAL', confidenceMultiplier: 1, sizeMultiplier: 1, reason: 'Wallet reset' },
    logs: [{ timestamp: new Date().toISOString(), message: '🔄 Wallet reset - clean state restored', type: 'info' }]
};

const { error: upErr } = await supabase
    .from('bot_state')
    .upsert({
        id: 'global_state',
        updated_at: new Date().toISOString(),
        capital: capital,
        total_trades: allTrades.length,
        win_rate: closedTrades.length > 0 ? (closedTrades.filter(t => parseFloat(t.pnl) > 0).length / closedTrades.length * 100) : 0,
        state_data: cleanState
    }, { onConflict: 'id' });

if (upErr) {
    console.error('Error updating bot_state:', upErr.message);
    process.exit(1);
}

console.log('✅ bot_state table reset successfully!');
console.log(`   Capital: $${capital.toFixed(2)}`);
console.log(`   Active trades: 0`);
console.log(`   Mode: NEUTRAL`);
