import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { data: allTrades, error } = await supabase
    .from('trades')
    .select('*')
    .order('created_at', { ascending: true });

if (error) { console.log('Error:', error.message); process.exit(1); }

console.log('Total trades from DB:', allTrades.length);

let totalTrades = 0;
const openTrades = [];

allTrades.forEach(trade => {
    totalTrades++;
    if (trade.status === 'OPEN') {
        openTrades.push(trade.question?.substring(0, 50));
    }
});

const totalRealizedPnL = allTrades
    .filter(t => t.status !== 'OPEN')
    .reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);

const activeInvested = allTrades
    .filter(t => t.status === 'OPEN')
    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

const reconstructedCapital = 1000 + totalRealizedPnL - activeInvested;

console.log('OPEN trades:', openTrades.length);
if (openTrades.length > 0) {
    openTrades.forEach(t => console.log('  -', t));
}
console.log('Realized PnL:', totalRealizedPnL.toFixed(2));
console.log('Active invested:', activeInvested.toFixed(2));
console.log('Reconstructed Capital:', reconstructedCapital.toFixed(2));
console.log('Total trades:', totalTrades);
console.log('Recovery would apply:', openTrades.length > 0 || totalTrades > 0);
