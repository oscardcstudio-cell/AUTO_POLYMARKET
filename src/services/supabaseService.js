
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';

import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("⚠️  WARNING: Supabase credentials missing in process.env. Persistence disabled.");
}

export const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export const supabaseService = {
    /**
     * Save or update a trade in Supabase
     * @param {Object} trade - The trade object from botState
     */
    async saveTrade(trade) {
        if (!supabase) {
            console.warn('⚠️ Supabase not configured, skipping trade save');
            return null;
        }

        try {
            // Map bot trade object to DB schema
            const dbTrade = {
                market_id: trade.marketId || trade.id, // Fallback
                question: trade.question,
                side: trade.side,
                amount: trade.amount || trade.size || 0,
                entry_price: trade.entryPrice,
                exit_price: trade.exitPrice || null,
                pnl: trade.pnl || 0,
                pnl_percent: trade.pnlPercent || 0,
                status: trade.status || (trade.exitPrice ? 'CLOSED' : 'OPEN'),
                confidence: trade.confidence,
                strategy: trade.strategy || 'standard',
                metadata: {
                    reasons: trade.decisionReasons || [],
                    marketData: trade.marketData || {},
                    slug: trade.slug,
                    eventSlug: trade.eventSlug
                }
            };

            let result;

            if (trade.supabase_id) {
                // Update existing trade
                result = await supabase
                    .from('trades')
                    .update(dbTrade)
                    .eq('id', trade.supabase_id)
                    .select()
                    .single();
            } else {
                // ANTI-DUPLICATE: Check if similar trade already exists
                const { data: existing } = await supabase
                    .from('trades')
                    .select('id')
                    .eq('market_id', dbTrade.market_id)
                    .eq('amount', dbTrade.amount)
                    .eq('entry_price', dbTrade.entry_price)
                    .eq('status', dbTrade.status)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (existing && existing.length > 0) {
                    console.log(`⚠️ Trade already exists in Supabase, skipping: ${trade.question.substring(0, 40)}...`);
                    // Attach the existing ID to avoid future duplicates
                    trade.supabase_id = existing[0].id;
                    return existing[0];
                }

                // Insert new trade
                result = await supabase
                    .from('trades')
                    .insert(dbTrade)
                    .select()
                    .single();
            }

            if (result.error) throw result.error;

            // Save back the UUID to local state
            if (result.data) {
                trade.supabase_id = result.data.id;
            }

            console.log(`✅ Trade saved to Supabase: ${trade.question}`);
            return result.data;

        } catch (error) {
            console.error('❌ Supabase Save Error:', error.message);
            return null;
        }
    },

    /**
     * Load recent trades from Supabase (for initialization)
     */
    async loadRecentTrades(limit = 50) {
        const { data, error } = await supabase
            .from('trades')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('❌ Supabase Load Error:', error.message);
            return [];
        }
        return data;
    }
};
