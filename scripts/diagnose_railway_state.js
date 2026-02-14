
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
    console.error("Current env:", process.env.SUPABASE_KEY ? "KEY PRESENT" : "KEY MISSING");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log("🔍 Diagnosing Railway State via Supabase...\n");

    // 1. Check Bot State (JSON blob)
    const { data: stateData, error: stateError } = await supabase
        .from('bot_state')
        .select('*')
        .eq('id', 'global_state')
        .single();

    let botState = stateData ? stateData.state_data : null;
    let dbUpdated = stateData ? new Date(stateData.updated_at) : null;

    if (!botState) {
        const { data: allStates } = await supabase.from('bot_state').select('*').limit(1);
        if (allStates && allStates.length > 0) {
            botState = allStates[0].state_data;
            dbUpdated = new Date(allStates[0].updated_at);
            console.log(`ℹ️ Found state row (ID: ${allStates[0].id})`);
        }
    }

    if (botState) {
        const timeSinceUpdate = (new Date() - dbUpdated) / 60000;
        console.log(`📦 State Last Updated: ${dbUpdated.toLocaleString()} (${timeSinceUpdate.toFixed(1)} min ago)`);
        if (timeSinceUpdate > 10) console.log("⚠️ WARNING: State not updated in >10 mins. Bot might be crashed.");
        else console.log("✅ Bot seems ACTIVE (state is recent).");

        console.log(`💰 Capital: $${(botState.capital || 0).toFixed(2)}`);
        console.log(`📈 Active Trades: ${botState.activeTrades ? botState.activeTrades.length : 0}`);
        console.log(`🏁 Closed Trades: ${botState.closedTrades ? botState.closedTrades.length : 0}`);
        console.log(`📊 Total Trades: ${botState.totalTrades || 0}`);
        console.log(`📅 Daily PnL: $${(botState.dailyPnL || 0).toFixed(2)}`);

        if (botState.activeTrades && botState.activeTrades.length > 0) {
            console.log("\n--- Active Trades ---");
            botState.activeTrades.forEach((t, i) => {
                const lastPrice = t.priceHistory && t.priceHistory.length > 0
                    ? t.priceHistory[t.priceHistory.length - 1]
                    : t.entryPrice;
                const pnl = t.shares ? (t.shares * lastPrice - t.amount) : 0;
                const pnlPct = t.amount > 0 ? (pnl / t.amount * 100) : 0;
                console.log(`  ${i + 1}. ${t.side} "${(t.question || '').substring(0, 40)}..." | $${t.amount?.toFixed(2)} @ ${t.entryPrice?.toFixed(3)} | PnL: ${pnlPct.toFixed(1)}%`);
            });
        }
    } else {
        console.error("❌ No state found in 'bot_state' table.");
    }

    console.log("\n-----------------------------------");

    // 2. Check trades table (the real source of truth)
    const { count: activeCount, error: activeErr } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'OPEN');

    const { count: closedCount, error: closedErr } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'OPEN');

    if (activeErr) console.log(`⚠️ Error reading trades table: ${activeErr.message}`);
    else {
        console.log(`📊 DB Active Trades (status=OPEN): ${activeCount}`);
        console.log(`📚 DB Closed Trades (status≠OPEN): ${closedCount}`);
    }

    // Compare state vs DB
    if (botState && activeCount !== null) {
        const stateActive = botState.activeTrades ? botState.activeTrades.length : 0;
        if (stateActive !== activeCount) {
            console.log(`⚠️ MISMATCH: State says ${stateActive} active, DB says ${activeCount}.`);
        } else {
            console.log("✅ Active Trades Count Matched.");
        }
    }

    console.log("\n-----------------------------------");

    // 3. Portfolio Check - sum PnL from closed trades
    const { data: closedTrades } = await supabase
        .from('trades')
        .select('pnl, amount, question, status')
        .neq('status', 'OPEN');

    let dbPnL = 0;
    if (closedTrades && closedTrades.length > 0) {
        dbPnL = closedTrades.reduce((acc, t) => acc + (parseFloat(t.pnl) || 0), 0);
        console.log(`🧮 Realized PnL from DB: $${dbPnL.toFixed(2)} (${closedTrades.length} closed trades)`);
    } else {
        console.log("ℹ️ No closed trades in DB yet.");
    }

    if (botState) {
        const impliedCapital = 1000 + dbPnL;
        const activeInvested = (botState.activeTrades || []).reduce((s, t) => s + (t.amount || 0), 0);
        console.log(`🤔 Implied Capital (1000 + PnL - Active): $${(impliedCapital - activeInvested).toFixed(2)}`);
        console.log(`🆚 Actual State Capital: $${botState.capital.toFixed(2)}`);

        if (Math.abs(impliedCapital - activeInvested - botState.capital) > 50) {
            console.log("⚠️ LARGE CAPITAL DISCREPANCY! Check trade history.");
        } else {
            console.log("✅ Capital looks consistent.");
        }
    }

    // 4. AI Learning Status
    if (botState && botState.learningParams) {
        console.log(`\n🧠 AI Mode: ${botState.learningParams.mode} | Confidence: x${botState.learningParams.confidenceMultiplier} | Size: x${botState.learningParams.sizeMultiplier}`);
    }

    console.log("\n✅ Diagnosis complete.");
}

diagnose();
