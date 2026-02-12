
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchRecentLogs() {
    console.log("🔍 Fetching recent system_logs from Supabase...");

    // Fetch specifically logs related to our issue
    const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('id', { ascending: false })
        .limit(50);

    if (error) {
        console.error("❌ Error fetching logs:", error);
        return;
    }

    if (!data || data.length === 0) {
        console.log("⚠️ No logs found in 'system_logs' table.");
        return;
    }

    console.log(`✅ Found ${data.length} recent logs.`);
    data.reverse().forEach(log => {
        const timestamp = new Date(log.created_at || log.timestamp).toLocaleTimeString();
        let indicator = "ℹ️";
        if (log.type === 'ERROR') indicator = "❌";
        if (log.type === 'WARNING') indicator = "⚠️";
        if (log.type === 'SUCCESS') indicator = "✅";

        console.log(`[${timestamp}] ${indicator} [${log.type}] ${log.message}`);
    });
}

fetchRecentLogs();
