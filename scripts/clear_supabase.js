
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix dotenv path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Supabase credentials missing in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function clearTrades() {
    console.log("🗑️ Clearing Supabase 'trades' table...");

    // Supabase requires a WHERE clause for delete protection.
    // Deleting all trades created after year 2000 covers everything.
    const { count, error } = await supabase
        .from('trades')
        .delete({ count: 'exact' })
        .gte('created_at', '2000-01-01T00:00:00Z');

    if (error) {
        console.error('❌ Error clearing trades:', error.message);
    } else {
        console.log(`✅ Successfully deleted ${count !== null ? count : '?'} trades.`);
    }
}

clearTrades();
