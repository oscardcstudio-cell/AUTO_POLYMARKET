import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function cleanupDuplicates() {
    console.log('🧹 Starting duplicate cleanup...\n');

    // Get all trades
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    console.log(`📊 Found ${trades.length} total trades\n`);

    // Group by market_id + amount + entry_price (duplicate signature)
    const groups = {};
    trades.forEach(trade => {
        const key = `${trade.market_id}_${trade.amount}_${trade.entry_price}_${trade.status}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(trade);
    });

    // Find duplicates
    const duplicates = Object.values(groups).filter(group => group.length > 1);

    console.log(`🔍 Found ${duplicates.length} groups with duplicates:\n`);

    let totalDeleted = 0;

    for (const group of duplicates) {
        console.log(`\n📌 Market: ${group[0].question.substring(0, 50)}...`);
        console.log(`   ${group.length} duplicates found`);

        // Keep the newest one (last in array after sorting by created_at asc)
        const toKeep = group[group.length - 1];
        const toDelete = group.slice(0, -1);

        console.log(`   ✅ Keeping: ${toKeep.id} (${toKeep.created_at})`);

        for (const dup of toDelete) {
            console.log(`   ❌ Deleting: ${dup.id} (${dup.created_at})`);

            const { error: delError } = await supabase
                .from('trades')
                .delete()
                .eq('id', dup.id);

            if (delError) {
                console.error(`   ⚠️ Error deleting ${dup.id}:`, delError.message);
            } else {
                totalDeleted++;
            }
        }
    }

    console.log(`\n✅ Cleanup complete! Deleted ${totalDeleted} duplicate trades.`);

    // Verify
    const { data: afterCleanup } = await supabase
        .from('trades')
        .select('id')
        .order('created_at', { ascending: false });

    console.log(`📊 Remaining trades: ${afterCleanup.length}\n`);
}

cleanupDuplicates().catch(console.error);
