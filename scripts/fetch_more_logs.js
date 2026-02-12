
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchLogs() {
    console.log("🔍 Fetching last 50 system logs from Supabase...\n");
    const { data: logs, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(50);

    if (error) {
        console.error("❌ Error fetching logs:", error.message);
    } else if (logs && logs.length > 0) {
        logs.reverse().forEach(log => {
            const time = new Date(log.timestamp).toLocaleString();
            console.log(`[${time}] [${log.type}] ${log.message}`);
        });
    } else {
        console.log("No logs found.");
    }
}

fetchLogs();
