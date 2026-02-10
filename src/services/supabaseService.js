
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
    },

    /**
     * Reconstructs the entire bot state from Supabase history.
     * Useful for disaster recovery (e.g. lost local file on Railway).
     */
    async recoverState() {
        if (!supabase) return null;

        try {
            console.log("🔄 Tentative de reconstruction de l'état depuis Supabase...");

            // 1. Fetch ALL trades (might need pagination for large history, limiting to 2000 for now)
            const { data: allTrades, error } = await supabase
                .from('trades')
                .select('*')
                .order('created_at', { ascending: true }); // Chronological order

            if (error) throw error;
            if (!allTrades || allTrades.length === 0) return null;

            // 2. Re-calculate metrics
            let reconstructedCapital = CONFIG.STARTING_CAPITAL || 1000;
            let totalTrades = 0;
            let winningTrades = 0;
            let losingTrades = 0;
            const activeTrades = [];
            const closedTrades = [];

            allTrades.forEach(trade => {
                const amount = parseFloat(trade.amount) || 0;
                const pnl = parseFloat(trade.pnl) || 0;
                const status = trade.status;

                totalTrades++;

                if (status === 'OPEN') {
                    // Deduct capital for active trades
                    reconstructedCapital -= amount;
                    // Map back to bot format
                    activeTrades.push({
                        id: trade.metadata?.marketData?.id || trade.market_id, // Prefer original ID
                        marketId: trade.market_id,
                        question: trade.question,
                        side: trade.side,
                        amount: amount,
                        entryPrice: trade.entry_price,
                        status: 'OPEN',
                        confidence: trade.confidence,
                        decisionReasons: trade.metadata?.reasons || [],
                        category: trade.metadata?.marketData?.category || 'unknown',
                        supabase_id: trade.id,
                        startTime: trade.created_at
                    });
                } else {
                    // Closed trades: Capital reflects PnL (Start + PnL - ActiveCost, but here we just Add PnL to base? 
                    // No. Cash = Start + Sum(Realized PnL) - Sum(Active Cost)
                    // So we don't deduct amount here, we just add PnL which is (Return - Cost).
                    // If PnL is accurate in DB (Net Profit), then:
                    // NewCash = OldCash + PnL.
                    // But wait. When we buy, we do Capital -= Amount. 
                    // When we sell, Capital += (Amount + PnL).
                    // So Net Change = PnL.
                    // Correct logic: ReconstructedCapital = 1000 + Sum(All PnL) - Sum(Open Trade Amounts).
                }

                if (status !== 'OPEN') {
                    if (pnl > 0) winningTrades++;
                    else losingTrades++;

                    closedTrades.push(trade);
                }
            });

            // Calculate Total Realized PnL
            const totalRealizedPnL = allTrades
                .filter(t => t.status !== 'OPEN')
                .reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);

            // Final Calculation
            reconstructedCapital = (CONFIG.STARTING_CAPITAL || 1000) + totalRealizedPnL;

            // Deduct Open Trades Cost (since they are "Invested")
            const activeInvested = activeTrades.reduce((sum, t) => sum + t.amount, 0);
            reconstructedCapital -= activeInvested;

            // Fix: Add missing 'shares' field to recovered active trades (needed for PnL calc)
            activeTrades.forEach(t => {
                if (!t.shares && t.amount && t.entryPrice && t.entryPrice > 0) {
                    t.shares = t.amount / t.entryPrice;
                }
            });

            // Fix: Generate synthetic logs from recovered trades so the dashboard
            // Trade Activity Logs section has data to display (instead of "Waiting...")
            const recoveredLogs = [];
            allTrades.forEach(trade => {
                const amount = parseFloat(trade.amount) || 0;
                const pnl = parseFloat(trade.pnl) || 0;

                if (trade.status === 'OPEN') {
                    recoveredLogs.push({
                        timestamp: trade.created_at,
                        message: `✅ TRADE OPENED: ${trade.side} sur "${(trade.question || '').substring(0, 30)}..." @ $${(trade.entry_price || 0).toFixed(3)} ($${amount.toFixed(2)})`,
                        type: 'trade'
                    });
                } else {
                    const isWin = pnl > 0;
                    recoveredLogs.push({
                        timestamp: trade.created_at,
                        message: isWin
                            ? `✅ Trade gagné: ${(trade.question || '').substring(0, 30)}... (+${pnl.toFixed(2)} USDC)`
                            : `❌ Trade perdu: ${(trade.question || '').substring(0, 30)}... (${pnl.toFixed(2)} USDC)`,
                        type: isWin ? 'success' : 'warning'
                    });
                }
            });

            // Sort newest first, limit to 200 (same as addLog limit)
            recoveredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            console.log(`✅ État reconstruit : Capital $${reconstructedCapital.toFixed(2)} | Actifs: ${activeTrades.length} | Fermés: ${closedTrades.length} | Logs: ${recoveredLogs.length}`);

            return {
                capital: reconstructedCapital,
                totalTrades,
                winningTrades,
                losingTrades,
                activeTrades,
                closedTrades: closedTrades.slice(-50).reverse(), // Keep last 50, newest first
                logs: recoveredLogs.slice(0, 1000), // Synthetic logs for dashboard display
                recovered: true
            };

        } catch (err) {
            console.error("❌ Erreur reconstruction via Supabase:", err.message);
            return null;
        }
    }
};
