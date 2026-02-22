
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Supabase credentials missing!");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fullReset() {
    console.log("🚀 Starting TOTAL RESET (Supabase + Local)...");

    const tables = ['trades', 'bot_state', 'simulation_runs'];

    for (const table of tables) {
        console.log(`🧹 Wiping table: ${table}...`);
        // Use a filter that matches everything (gte 2000 for created_at or just neq null)
        const { count, error } = await supabase
            .from(table)
            .delete({ count: 'exact' })
            .neq('id', '00000000-0000-0000-0000-000000000000'); // This is usually safe if ID is UUID

        if (error) {
            // Backup delete method if neq fails
            console.log(`⚠️  neq filter failed for ${table}, trying gte created_at...`);
            const { error: error2 } = await supabase
                .from(table)
                .delete()
                .gte('created_at', '1970-01-01T00:00:00Z');

            if (error2) console.error(`❌ Second attempt failed for ${table}:`, error2.message);
            else console.log(`✅ Table ${table} cleared (backup method).`);
        } else {
            console.log(`✅ Table ${table} cleared (${count} rows).`);
        }
    }

    console.log("📁 Resetting local bot_data.json...");
    const cleanState = {
        startTime: new Date().toISOString(),
        capital: 1000,
        startingCapital: 1000,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        activeTrades: [],
        closedTrades: [],
        logs: [{ timestamp: new Date().toISOString(), message: "🚀 Système réinitialisé à $1000.", type: "success" }],
        learningParams: { mode: 'NEUTRAL', confidenceMultiplier: 1.0 }
    };

    fs.writeFileSync('bot_data.json', JSON.stringify(cleanState, null, 2));
    console.log("✅ Local bot_data.json is now clean.");

    console.log("\n✨ TOTAL RESET COMPLETE. Please restart the bot and refresh the dashboard.");
}

fullReset();
