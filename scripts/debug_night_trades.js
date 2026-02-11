
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function analyzeTrades() {
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error fetching trades:', error);
        return;
    }

    console.log(`Fetched ${trades.length} recent trades.`);

    let totalPnL = 0;
    let winning = 0;
    let losing = 0;
    let totalInvested = 0;

    console.log('\n--- Recent Trades (Last 12h approx) ---');

    // Filter for "last night" (assuming UTC or local time, let's just show top 20)
    // Show CLOSED trades specifically
    const closedTrades = trades.filter(t => t.status !== 'OPEN');
    console.log(`\nFound ${closedTrades.length} CLOSED trades in the last 100 entries.`);

    const displayTrades = closedTrades.slice(0, 20);

    displayTrades.forEach(t => {
        const pnl = parseFloat(t.pnl) || 0;
        const amount = parseFloat(t.amount) || 0;
        const entry = parseFloat(t.entry_price) || 0;
        const exit = parseFloat(t.exit_price) || 0;

        totalPnL += pnl;
        totalInvested += amount;
        if (pnl > 0) winning++;
        if (pnl < 0) losing++;

        const pnlPercent = amount > 0 ? (pnl / amount * 100).toFixed(2) : 0;

        console.log(`[${new Date(t.created_at).toLocaleString()}] ${t.side} ${t.question.substring(0, 30)}...`);
        console.log(`   Entry: $${entry.toFixed(3)} | Exit: $${exit.toFixed(3)} | Amount: $${amount.toFixed(2)} | PnL: $${pnl.toFixed(2)} (${pnlPercent}%)`);
        console.log(`   Status: ${t.status} | Strat: ${t.strategy || 'N/A'}`);
    });

    console.log('\n--- Summary (Top 20) ---');
    console.log(`Total PnL: $${totalPnL.toFixed(2)}`);
    console.log(`Wins: ${winning} | Losses: ${losing}`);
    console.log(`Avg Trade Size: $${(totalInvested / recentTrades.length).toFixed(2)}`);

    // CHECK SIMULATION RUNS
    console.log('\n--- Recent Simulation Runs ---');
    const { data: sims, error: simError } = await supabase
        .from('simulation_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (sims) {
        sims.forEach(s => {
            console.log(`[${new Date(s.created_at).toLocaleString()}] ${s.run_type} | ROI: ${s.result_roi}% | PnL: $${s.result_pnl} | WinRate: ${s.win_rate}%`);
        });
    }
}

analyzeTrades();
