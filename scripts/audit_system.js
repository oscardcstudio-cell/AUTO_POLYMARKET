
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Load env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

console.log("🔍 STARTING SYSTEM AUDIT...\n");

async function audit() {
    let score = 0;
    const maxScore = 5;

    // 1. SUPABASE CONNECTION & TABLES
    console.log("1️⃣  Checking Supabase...");
    if (!supabaseUrl || !supabaseKey) {
        console.error("❌ FAIL: Missing Env Vars");
    } else {
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Check 'bot_state'
        const { error: stateError } = await supabase.from('bot_state').select('id').limit(1);
        if (stateError) {
            console.error(`❌ FAIL: 'bot_state' table not accessible. (${stateError.message})`);
            console.error("👉 DID YOU RUN SUPABASE_FIX.sql?");
        } else {
            console.log("✅ PASS: 'bot_state' table found.");
            score++;
        }

        // Check 'trades'
        const { error: tradesError } = await supabase.from('trades').select('id').limit(1);
        if (tradesError) console.error(`❌ FAIL: 'trades' table error: ${tradesError.message}`);
        else console.log("✅ PASS: 'trades' table found.");

        // Check 'simulation_runs'
        const { error: simError } = await supabase.from('simulation_runs').select('id').limit(1);
        if (simError) console.error(`❌ FAIL: 'simulation_runs' table missing. Auto-Training will fail.`);
        else console.log("✅ PASS: 'simulation_runs' table found.");
    }

    console.log("\n2️⃣  Checking APIs...");

    // 2. GAMMA API
    try {
        const gammaRes = await fetch('https://gamma-api.polymarket.com/events?limit=1');
        if (gammaRes.ok) {
            console.log("✅ PASS: Gamma API (Markets) reachable.");
            score++;
        } else {
            console.error(`❌ FAIL: Gamma API Error ${gammaRes.status}`);
        }
    } catch (e) {
        console.error(`❌ FAIL: Gamma API Unreachable (${e.message})`);
    }

    // 3. CLOB API
    try {
        // Fetch a known market's order book (or just check health/time)
        const clobRes = await fetch('https://clob.polymarket.com/time');
        if (clobRes.ok) {
            console.log("✅ PASS: CLOB API reachable.");
            score++;
        } else {
            console.error(`❌ FAIL: CLOB API Error ${clobRes.status}`);
        }
    } catch (e) {
        console.error(`❌ FAIL: CLOB API Unreachable (${e.message})`);
    }

    console.log("\n3️⃣  Checking Local Files...");

    // 4. Config & State
    if (fs.existsSync('src/config.js')) console.log("✅ PASS: config.js found.");
    else console.error("❌ FAIL: config.js missing.");

    if (fs.existsSync('bot_data.json')) {
        console.log("✅ PASS: bot_data.json (Local State) found.");
        score++;
    } else {
        console.warn("⚠️  WARN: bot_data.json missing (Bot will start fresh).");
    }

    console.log("\n4️⃣  Checking Code Integration...");

    // Check if scheduler is imported in server.js
    const serverContent = fs.readFileSync('server.js', 'utf8');
    if (serverContent.includes('startScheduler')) {
        console.log("✅ PASS: Scheduler is wired in server.js");
        score++;
    } else {
        console.error("❌ FAIL: Scheduler NOT started in server.js!");
    }

    console.log("\n-----------------------------------");
    console.log(`🏁 AUDIT COMPLETE. Score: ${score}/${maxScore}`);
    if (score === maxScore) console.log("🚀 SYSTEM IS HEALTHY AND READY.");
    else console.log("⚠️  SYSTEM HAS ISSUES. PLEASE FIX ABOVE ERRORS.");
}

audit();
