
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Credentials missing in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchRemoteLogs() {
    console.log('🔍 Fetching remote logs from Supabase...\n');

    const { data: logs, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(50);

    if (error) {
        console.error('❌ Error fetching logs:', error.message);
        console.log('💡 Did you create the table system_logs? (Run SUPABASE_FIX.sql)');
        return;
    }

    if (!logs || logs.length === 0) {
        console.log('📭 No logs found (yet).');
        return;
    }

    console.log('📋 LAST 50 LOGS (Most recent first):');
    console.log('─'.repeat(80));

    logs.forEach(log => {
        let color = '\x1b[36m'; // Cyan
        if (log.type === 'ERROR') color = '\x1b[31m'; // Red
        if (log.type === 'SUCCESS') color = '\x1b[32m'; // Green

        const time = new Date(log.timestamp).toLocaleTimeString();
        console.log(`${color}[${time}] [${log.type}] ${log.message}\x1b[0m`);
    });
    console.log('─'.repeat(80));
}

// Watch mode?
if (process.argv.includes('--watch')) {
    console.log('👀 Watching logs (every 5s)...');
    setInterval(fetchRemoteLogs, 5000);
} else {
    fetchRemoteLogs();
}
