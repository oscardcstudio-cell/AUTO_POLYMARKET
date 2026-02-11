
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

    // 1. Check Last System Log (Pulse)
    const { data: logs, error: logError } = await supabase
        .from('system_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(5);

    if (logError) console.error("Error fetching system_logs:", logError.message);
    else {
        if (logs.length > 0) {
            const lastLog = logs[0];
            const lastTime = new Date(lastLog.timestamp);
            const now = new Date();
            const diffMin = (now - lastTime) / 60000;

            console.log(`⏱️ Last Log: ${lastTime.toLocaleString()} (${diffMin.toFixed(1)} min ago)`);
            console.log(`   Message: [${lastLog.type}] ${lastLog.message}`);

            if (diffMin > 10) console.log("⚠️ WARNING: No logs in >10 mins. Bot might be crashed.");
            else console.log("✅ Bot seems ACTIVE (logs are recent).");
        } else {
            console.log("⚠️ No logs found.");
        }
    }

    console.log("\n-----------------------------------");

    // 2. Check Bot State (JSON)
    const { data: stateData, error: stateError } = await supabase
        .from('bot_state')
        .select('*')
        .eq('id', 'global_state') // Assuming single singleton row or verify user's row
        .single();

    // Fallback: fetch any row if 'global_state' not found (ID might be different)
    let botState = stateData ? stateData.state_data : null;
    let dbUpdated = stateData ? new Date(stateData.updated_at) : null;

    if (!botState) {
        const { data: allStates } = await supabase.from('bot_state').select('*').limit(1);
        if (allStates && allStates.length > 0) {
            botState = allStates[0].state_data;
            dbUpdated = new Date(allStates[0].updated_at);
            console.log(`ℹ️ Found generic state row (ID: ${allStates[0].id})`);
        }
    }

    if (botState) {
        const timeSinceUpdate = (new Date() - dbUpdated) / 60000;
        console.log(`📦 State Last Updated: ${dbUpdated.toLocaleString()} (${timeSinceUpdate.toFixed(1)} min ago)`);

        console.log(`💰 State Capital: $${(botState.capital || 0).toFixed(2)}`);
        console.log(`📈 Active Trades (State): ${botState.activeTrades ? botState.activeTrades.length : 0}`);
        console.log(`🏁 Closed Trades (State): ${botState.closedTrades ? botState.closedTrades.length : 0}`);
    } else {
        console.error("❌ Stats Not Found in 'bot_state' table.");
    }

    console.log("\n-----------------------------------");

    // 3. Check Tables (Source of Truth)
    const { count: activeCount } = await supabase.from('active_trades').select('*', { count: 'exact', head: true });
    const { count: closedCount } = await supabase.from('trade_history').select('*', { count: 'exact', head: true });

    console.log(`📊 DB Active Trades: ${activeCount}`);
    console.log(`📚 DB Closed Trades (History): ${closedCount}`);

    // Diff
    if (botState) {
        if (botState.activeTrades.length !== activeCount) {
            console.log(`⚠️ MISMATCH: State says ${botState.activeTrades.length} active, DB says ${activeCount}. Sync issue?`);
        } else {
            console.log("✅ Active Trades Count Matched.");
        }
    }

    console.log("\n-----------------------------------");

    // 4. Portfolio Check
    // If trade history exists, sum PnL
    const { data: history } = await supabase.from('trade_history').select('pnl');
    let dbPnL = 0;
    if (history) {
        dbPnL = history.reduce((acc, t) => acc + (parseFloat(t.pnl) || 0), 0);
    }
    console.log(`🧮 Calculated Realized PnL from DB: $${dbPnL.toFixed(2)}`);

    if (botState) {
        // Default starting capital 1000
        const impliedCapital = 1000 + dbPnL;
        console.log(`🤔 Implied Capital (1000 + PnL): $${impliedCapital.toFixed(2)}`);
        console.log(`🆚 Actual State Capital: $${botState.capital.toFixed(2)}`);

        if (Math.abs(impliedCapital - botState.capital) > 50) {
            console.log("⚠️ LARGE CAPITAL DISCREPANCY! State might have been reset or drifted.");
        }
    }
}

diagnose();
