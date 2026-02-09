import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchProductionData() {
    console.log('🔍 Fetching production data from Supabase...\n');

    // Get all trades
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    console.log(`📊 Found ${trades.length} trades in database\n`);

    // Analyze trades
    const openTrades = trades.filter(t => t.status === 'OPEN');
    const closedTrades = trades.filter(t => t.status === 'CLOSED');

    console.log(`✅ Open: ${openTrades.length}`);
    console.log(`✅ Closed: ${closedTrades.length}\n`);

    // Calculate stats
    const totalInvested = openTrades.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    console.log(`💰 Total invested (open): $${totalInvested.toFixed(2)}`);
    console.log(`💰 Total PnL (closed): $${totalPnL.toFixed(2)}\n`);

    // Show recent trades
    console.log('📋 Last 10 trades:');
    console.log('─'.repeat(80));
    trades.slice(0, 10).forEach(t => {
        const question = t.question.substring(0, 50);
        const status = t.status === 'OPEN' ? '🟢' : '🔴';
        const pnl = t.pnl ? `(PnL: $${t.pnl.toFixed(2)})` : '';
        console.log(`${status} [${t.side}] ${question}... | $${t.amount} @ ${t.entry_price?.toFixed(3)} ${pnl}`);
    });

    // Save to file for inspection
    fs.writeFileSync('railway_data_snapshot.json', JSON.stringify(trades, null, 2));
    console.log('\n✅ Data saved to railway_data_snapshot.json');
}

fetchProductionData().catch(console.error);
