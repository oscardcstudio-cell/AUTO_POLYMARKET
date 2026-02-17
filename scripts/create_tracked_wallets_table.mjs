/**
 * Create the tracked_wallets table in Supabase.
 * Run once: node scripts/create_tracked_wallets_table.mjs
 *
 * If this fails (RLS or permissions), create the table manually in Supabase dashboard:
 *
 * SQL to run in Supabase SQL Editor:
 *
 * CREATE TABLE IF NOT EXISTS tracked_wallets (
 *   wallet_address TEXT PRIMARY KEY,
 *   username TEXT,
 *   rank INTEGER,
 *   category TEXT DEFAULT 'OVERALL',
 *   pnl_7d DECIMAL DEFAULT 0,
 *   volume_7d DECIMAL DEFAULT 0,
 *   is_active BOOLEAN DEFAULT true,
 *   last_updated TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Enable RLS but allow service key full access
 * ALTER TABLE tracked_wallets ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "Allow all for service role" ON tracked_wallets FOR ALL USING (true);
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
    console.log('Testing Supabase connection...');

    // Test by trying to insert a dummy row (Supabase JS client can't run DDL)
    // The table must be created via the SQL editor above

    const { data, error } = await supabase
        .from('tracked_wallets')
        .select('wallet_address')
        .limit(1);

    if (error) {
        if (error.message.includes('does not exist') || error.code === '42P01') {
            console.log('\n❌ Table "tracked_wallets" does not exist yet.');
            console.log('\nPlease create it in the Supabase SQL Editor with this query:\n');
            console.log(`CREATE TABLE IF NOT EXISTS tracked_wallets (
  wallet_address TEXT PRIMARY KEY,
  username TEXT,
  rank INTEGER,
  category TEXT DEFAULT 'OVERALL',
  pnl_7d DECIMAL DEFAULT 0,
  volume_7d DECIMAL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  last_updated TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tracked_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON tracked_wallets FOR ALL USING (true);`);
        } else {
            console.error('Supabase error:', error);
        }
    } else {
        console.log('✅ Table "tracked_wallets" exists! Rows:', data.length);
    }
}

main().catch(console.error);
