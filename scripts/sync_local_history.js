import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabaseService } from '../src/services/supabaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '..', 'bot_data.json');

async function syncLocalHistory() {
    console.log('🔄 Starting Local History Sync...');
    console.log(`📂 Reading data from: ${DATA_FILE}`);

    try {
        if (!fs.existsSync(DATA_FILE)) {
            console.error('❌ bot_data.json not found!');
            process.exit(1);
        }

        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        const botData = JSON.parse(rawData);

        const activeTrades = botData.activeTrades || [];
        const closedTrades = botData.closedTrades || [];
        const allTrades = [...activeTrades, ...closedTrades];

        console.log(`📊 Found ${activeTrades.length} active trades and ${closedTrades.length} closed trades.`);
        console.log(`🚀 Syncing ${allTrades.length} trades to Supabase...`);

        let successCount = 0;
        let failCount = 0;

        for (const trade of allTrades) {
            // Ensure status is set correctly if missing
            if (!trade.status) {
                trade.status = trade.exitPrice ? 'CLOSED' : 'OPEN';
            }

            // Artificial delay to avoid rate limits if many trades
            await new Promise(r => setTimeout(r, 100));

            const result = await supabaseService.saveTrade(trade);
            if (result) {
                console.log(`✅ Synced: ${trade.question.substring(0, 40)}...`);
                successCount++;
            } else {
                console.warn(`⚠️ Failed to sync: ${trade.id} - ${trade.question}`);
                failCount++;
            }
        }

        console.log('\n🏁 Sync Complete!');
        console.log(`✅ Success: ${successCount}`);
        console.log(`❌ Failed: ${failCount}`);

        if (failCount > 0) {
            console.warn('⚠️ Some trades failed to sync. Check logs/Supabase connection.');
        }

        process.exit(0);

    } catch (error) {
        console.error('❌ Critical Error:', error);
        process.exit(1);
    }
}

syncLocalHistory();
