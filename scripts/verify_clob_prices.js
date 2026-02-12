
import { createClient } from '@supabase/supabase-js';
import { getCLOBMidpoint, getCLOBPrice } from '../src/api/clob_api.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

async function verify() {
    console.log("🔍 STARTING CLOB PRICE VERIFICATION...");

    // 1. Load Local State
    let localTrades = [];
    try {
        const botDataPath = path.join(ROOT_DIR, 'bot_data.json');
        if (fs.existsSync(botDataPath)) {
            const data = JSON.parse(fs.readFileSync(botDataPath, 'utf8'));
            localTrades = data.activeTrades || [];
            console.log(`✅ Loaded ${localTrades.length} active trades from local bot_data.json`);
        }
    } catch (e) {
        console.warn("⚠️ Could not load local bot_data.json:", e.message);
    }

    // 2. Load Supabase Trades
    let remoteTrades = [];
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('trades')
                .select('*')
                .eq('status', 'OPEN')
                .limit(50);

            if (error) throw error;
            remoteTrades = data || [];
            console.log(`✅ Loaded ${remoteTrades.length} OPEN trades from Supabase`);
        } catch (e) {
            console.warn("⚠️ Could not load trades from Supabase:", e.message);
        }
    }

    // 3. Load Market Cache for ID recovery
    let marketCache = [];
    try {
        const botDataPath = path.join(ROOT_DIR, 'bot_data.json');
        if (fs.existsSync(botDataPath)) {
            const data = JSON.parse(fs.readFileSync(botDataPath, 'utf8'));
            marketCache = data.marketCache || [];
        }
    } catch (e) { }

    // 4. Merge and Deduplicate (by question/marketId)
    const allTrades = [...localTrades];
    remoteTrades.forEach(rt => {
        const marketId = rt.market_id;
        if (!allTrades.find(lt => lt.marketId === marketId || lt.id === marketId)) {
            allTrades.push({
                marketId: rt.market_id,
                question: rt.question,
                entryPrice: rt.entry_price,
                clobTokenIds: rt.metadata?.clobTokenIds || [],
                slug: rt.metadata?.slug,
                side: rt.side,
                source: 'SUPABASE'
            });
        }
    });

    if (allTrades.length === 0) {
        console.log("❌ No active trades found to verify.");
        return;
    }

    console.log(`📊 Comparing prices for ${allTrades.length} unique trades...\n`);
    console.log(stringPad("QUESTION", 40) + " | " +
        stringPad("SIDE", 6) + " | " +
        stringPad("ENTRY", 10) + " | " +
        stringPad("LIVE PRICE", 10) + " | " +
        stringPad("SOURCE", 10) + " | " +
        "DIFF%");
    console.log("-".repeat(105));

    for (const trade of allTrades) {
        const qShort = (trade.question || 'Unknown').substring(0, 38);
        const entry = trade.entryPrice || 0;
        const side = trade.side || 'YES';

        let livePrice = null;
        let source = 'N/A';
        let tokenIds = trade.clobTokenIds;

        // Ensure tokenIds is an array (existing logic)
        if (typeof tokenIds === 'string') {
            try { tokenIds = JSON.parse(tokenIds); } catch (e) { tokenIds = []; }
        }

        // Recovery 1: Search in Market Cache
        if (!tokenIds || tokenIds.length === 0) {
            const cached = marketCache.find(m => m.id === trade.marketId || m.question === trade.question || m.slug === trade.slug);
            if (cached && cached.clobTokenIds) {
                tokenIds = cached.clobTokenIds;
                if (typeof tokenIds === 'string') {
                    try { tokenIds = JSON.parse(tokenIds); } catch (e) { tokenIds = []; }
                }
            }
        }

        // Live Fetch: Try CLOB
        if (tokenIds && tokenIds.length === 2) {
            const tokenId = side === 'YES' ? tokenIds[0] : tokenIds[1];
            try {
                livePrice = await getCLOBMidpoint(tokenId);
                if (!livePrice) livePrice = await getCLOBPrice(tokenId);
                if (livePrice) source = 'CLOB';
            } catch (e) { }
        }

        // Recovery 2: Try Gamma
        if (!livePrice && (trade.marketId || trade.slug)) {
            try {
                // We use a simple fetch to Gamma as fallback
                const gammaId = trade.marketId;
                if (gammaId && !isNaN(gammaId)) {
                    const res = await fetch(`https://gamma-api.polymarket.com/markets/${gammaId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.outcomePrices) {
                            const prices = JSON.parse(data.outcomePrices);
                            livePrice = side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
                            source = 'GAMMA';
                        }
                    }
                }
            } catch (e) { }
        }

        const priceStr = livePrice ? livePrice.toFixed(3) : "N/A";
        let diffStr = "N/A";

        if (livePrice && entry > 0) {
            const diff = ((livePrice - entry) / entry) * 100;
            diffStr = (diff >= 0 ? "+" : "") + diff.toFixed(1) + "%";
        }

        console.log(stringPad(qShort, 40) + " | " +
            stringPad(side, 6) + " | " +
            stringPad(entry.toFixed(3), 10) + " | " +
            stringPad(priceStr, 10) + " | " +
            stringPad(source, 10) + " | " +
            diffStr);
    }

    console.log("\n✅ Verification complete.");
}

function stringPad(str, len) {
    str = String(str);
    if (str.length >= len) return str.substring(0, len);
    return str + " ".repeat(len - str.length);
}

verify();
