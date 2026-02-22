
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspect() {
    const tables = ['trades', 'bot_state', 'simulation_runs'];

    for (const table of tables) {
        const { data, count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.log(`❌ Table ${table}: ${error.message}`);
        } else {
            console.log(`📊 Table ${table}: ${count} rows`);
        }
    }

    // Check specific capital state if possible
    const { data: botState } = await supabase.from('bot_state').select('*').limit(1);
    console.log('Current Bot State:', JSON.stringify(botState, null, 2));
}

inspect();
