
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Load env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

const INITIAL_CAPITAL = 1000;

async function resetBot() {
    console.log("⚠️  ATTENTION: This will WIPE all trade history and reset the bot.");
    console.log("⏳ Starting Reset Process...");

    // 1. Reset Supabase
    if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log("1️⃣  Cleaning Supabase Tables...");

        // Delete all trades
        const { error: err1 } = await supabase.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Hack to delete all
        if (err1) console.error("❌ Error clearing trades:", err1.message);
        else console.log("✅ 'trades' table cleared.");

        // Clear bot_state
        const { error: err2 } = await supabase.from('bot_state').delete().neq('id', 'placeholder');
        if (err2) console.error("❌ Error clearing bot_state:", err2.message);
        else console.log("✅ 'bot_state' table cleared.");

        // Clear history/runs?
        // await supabase.from('simulation_runs').delete().neq('id', '...');

    } else {
        console.warn("⚠️  Skipping Supabase reset (Missing credentials)");
    }

    // 2. Reset Local State
    console.log("2️⃣  Resetting Local File (bot_data.json)...");
    const blankState = {
        startTime: new Date().toISOString(),
        capital: INITIAL_CAPITAL,
        startingCapital: INITIAL_CAPITAL,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        activeTrades: [],
        closedTrades: [],
        logs: [],
        learningParams: { mode: 'NEUTRAL', confidenceMultiplier: 1.0 }
    };

    try {
        fs.writeFileSync('bot_data.json', JSON.stringify(blankState, null, 2));
        console.log("✅ Local bot_data.json reset to $1000.");
    } catch (e) {
        console.error("❌ Error writing bot_data.json:", e.message);
    }

    console.log("\n✨ RESET COMPLETE. RESTART THE BOT NOW.");
}

// Check for confirm flag if running manually? 
// For now just run it.
resetBot();
