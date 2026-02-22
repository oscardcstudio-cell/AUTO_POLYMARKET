import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// All CLOSED trades since Feb 21
const { data: trades, error } = await sb.from('trades').select('*').eq('status', 'CLOSED').gte('created_at', '2026-02-21T00:00:00Z').order('created_at', { ascending: false });
if (error) { console.error('ERR:', error.message); process.exit(1); }

console.log('=== TRADES SINCE FEB 21 ===');
console.log('Total closed:', trades.length);

const wins = trades.filter(t => (t.pnl || 0) > 0);
const losses = trades.filter(t => (t.pnl || 0) <= 0);
console.log('Wins:', wins.length, 'Losses:', losses.length);
console.log('Win Rate:', trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) + '%' : 'N/A');

const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0;
const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length : 0;
console.log('Total PnL: $' + totalPnl.toFixed(2));
console.log('Avg Win: $' + avgWin.toFixed(2), '| Avg Loss: $' + avgLoss.toFixed(2));
console.log('Gain/Loss Ratio:', avgLoss !== 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : 'N/A');

// By category
console.log('\n=== BY CATEGORY ===');
const cats = {};
trades.forEach(t => {
    const c = t.category || 'other';
    if (!cats[c]) cats[c] = { total: 0, wins: 0, pnl: 0 };
    cats[c].total++;
    if ((t.pnl || 0) > 0) cats[c].wins++;
    cats[c].pnl += (t.pnl || 0);
});
Object.entries(cats).sort((a, b) => b[1].pnl - a[1].pnl).forEach(([c, d]) => {
    console.log(c + ': ' + d.total + ' trades, ' + d.wins + ' wins (' + ((d.wins / d.total) * 100).toFixed(0) + '% WR), PnL: $' + d.pnl.toFixed(2));
});

// By strategy
console.log('\n=== BY STRATEGY ===');
const strats = {};
trades.forEach(t => {
    const s = t.strategy || 'standard';
    if (!strats[s]) strats[s] = { total: 0, wins: 0, pnl: 0 };
    strats[s].total++;
    if ((t.pnl || 0) > 0) strats[s].wins++;
    strats[s].pnl += (t.pnl || 0);
});
Object.entries(strats).sort((a, b) => b[1].pnl - a[1].pnl).forEach(([s, d]) => {
    console.log(s + ': ' + d.total + ' trades, ' + d.wins + ' wins (' + ((d.wins / d.total) * 100).toFixed(0) + '% WR), PnL: $' + d.pnl.toFixed(2));
});

// By side
console.log('\n=== BY SIDE ===');
const sides = {};
trades.forEach(t => {
    const s = t.side || '?';
    if (!sides[s]) sides[s] = { total: 0, wins: 0, pnl: 0 };
    sides[s].total++;
    if ((t.pnl || 0) > 0) sides[s].wins++;
    sides[s].pnl += (t.pnl || 0);
});
Object.entries(sides).forEach(([s, d]) => {
    console.log(s + ': ' + d.total + ' trades, ' + d.wins + ' wins (' + ((d.wins / d.total) * 100).toFixed(0) + '% WR), PnL: $' + d.pnl.toFixed(2));
});

// Top 5 winners and losers
console.log('\n=== TOP 5 WINNERS ===');
const sorted = [...trades].sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
sorted.slice(0, 5).forEach(t => {
    console.log('+$' + t.pnl?.toFixed(2), t.strategy, t.category, t.side, t.question?.substring(0, 55));
});

console.log('\n=== TOP 5 LOSERS ===');
sorted.slice(-5).reverse().forEach(t => {
    const pctLoss = t.amount > 0 ? ((t.pnl / t.amount) * 100).toFixed(0) : '?';
    console.log('-$' + Math.abs(t.pnl || 0).toFixed(2), '(' + pctLoss + '%)', t.strategy, t.category, t.side, t.question?.substring(0, 50));
});

// By day
console.log('\n=== BY DAY ===');
const days = {};
trades.forEach(t => {
    const d = (t.created_at || '').substring(0, 10);
    if (!days[d]) days[d] = { total: 0, wins: 0, pnl: 0 };
    days[d].total++;
    if ((t.pnl || 0) > 0) days[d].wins++;
    days[d].pnl += (t.pnl || 0);
});
Object.entries(days).sort().forEach(([d, v]) => {
    console.log(d + ': ' + v.total + ' trades, ' + v.wins + ' wins (' + ((v.wins / v.total) * 100).toFixed(0) + '% WR), PnL: $' + v.pnl.toFixed(2));
});

// Big losses check (> $3 lost)
console.log('\n=== BIG LOSSES (> $3) ===');
trades.filter(t => (t.pnl || 0) < -3).forEach(t => {
    const pctLoss = t.amount > 0 ? ((t.pnl / t.amount) * 100).toFixed(0) : '?';
    console.log('-$' + Math.abs(t.pnl).toFixed(2), '(' + pctLoss + '%)', t.strategy, t.category, t.side, '@' + (t.entry_price || '?'), t.question?.substring(0, 50));
});

// Copy trade performance
console.log('\n=== COPY TRADE PERFORMANCE ===');
const copyTrades = trades.filter(t => t.strategy === 'copy_trade');
if (copyTrades.length > 0) {
    const copyWins = copyTrades.filter(t => (t.pnl || 0) > 0);
    console.log('Total:', copyTrades.length, 'Wins:', copyWins.length, 'WR:', (copyWins.length / copyTrades.length * 100).toFixed(0) + '%');
    console.log('Total PnL: $' + copyTrades.reduce((s, t) => s + (t.pnl || 0), 0).toFixed(2));
    copyTrades.forEach(t => {
        console.log('  ' + (t.pnl > 0 ? '+' : '') + '$' + t.pnl?.toFixed(2), t.side, t.question?.substring(0, 50));
    });
} else {
    console.log('No copy_trade strategy trades found');
}

// Whale strategy performance
console.log('\n=== WHALE STRATEGY PERFORMANCE ===');
const whaleTrades = trades.filter(t => t.strategy === 'whale');
if (whaleTrades.length > 0) {
    const whaleWins = whaleTrades.filter(t => (t.pnl || 0) > 0);
    console.log('Total:', whaleTrades.length, 'Wins:', whaleWins.length, 'WR:', (whaleWins.length / whaleTrades.length * 100).toFixed(0) + '%');
    console.log('Total PnL: $' + whaleTrades.reduce((s, t) => s + (t.pnl || 0), 0).toFixed(2));
    console.log('Avg size: $' + (whaleTrades.reduce((s, t) => s + (t.amount || 0), 0) / whaleTrades.length).toFixed(2));
    whaleTrades.forEach(t => {
        console.log('  ' + (t.pnl > 0 ? '+' : '') + '$' + t.pnl?.toFixed(2), '$' + t.amount?.toFixed(0), t.side, t.category, t.question?.substring(0, 45));
    });
} else {
    console.log('No whale strategy trades found');
}
