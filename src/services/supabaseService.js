
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';
import { strategyAdapter } from '../logic/strategyAdapter.js';

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
     * Save the entire bot state to Supabase (JSON blob)
     * Limit frequency to avoid rate limits (e.g. only on major updates)
     */
    async saveState(stateData) {
        if (!supabase) return;

        try {
            // Remove heavy log arrays to save bandwidth/storage
            const cleanState = { ...stateData };
            if (cleanState.logs && cleanState.logs.length > 50) {
                cleanState.logs = cleanState.logs.slice(0, 50);
            }

            const { error } = await supabase
                .from('bot_state')
                .upsert({
                    id: 'global_state',
                    updated_at: new Date().toISOString(),
                    capital: cleanState.capital,
                    total_trades: cleanState.totalTrades,
                    win_rate: cleanState.winRate || 0,
                    state_data: cleanState
                }, { onConflict: 'id' });

            if (error) {
                console.error("❌ Supabase State Save Error:", error.message);
            }
        } catch (e) {
            console.error("❌ State Save Exception:", e);
        }
    },

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
                category: trade.category || 'General',
                metadata: {
                    reasons: trade.reasons || [],
                    marketData: trade.marketData || {},
                    slug: trade.slug,
                    eventSlug: trade.eventSlug,
                    partialExit: trade.partialExit || false,
                    originalTP: trade.originalTP || null,
                    convictionScore: trade.convictionScore || null
                }
            };

            // Explicitly set created_at if provided (for history sync)
            if (trade.startTime) {
                dbTrade.created_at = trade.startTime;
            }

            let result;

            if (trade.supabase_id) {
                // Update existing trade (e.g. when closing)
                result = await supabase
                    .from('trades')
                    .update(dbTrade)
                    .eq('id', trade.supabase_id)
                    .select()
                    .single();
            } else {
                // ANTI-DUPLICATE: Check if trade already exists (by market_id + entry_price + amount)
                // Don't filter by status so we can find OPEN trades when closing them
                const { data: existing } = await supabase
                    .from('trades')
                    .select('id, status')
                    .eq('market_id', dbTrade.market_id)
                    .eq('amount', dbTrade.amount)
                    .eq('entry_price', dbTrade.entry_price)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (existing && existing.length > 0) {
                    // Found existing trade - update it (handles OPEN -> CLOSED transitions)
                    trade.supabase_id = existing[0].id;
                    result = await supabase
                        .from('trades')
                        .update(dbTrade)
                        .eq('id', existing[0].id)
                        .select()
                        .single();
                } else {
                    // Insert new trade
                    result = await supabase
                        .from('trades')
                        .insert(dbTrade)
                        .select()
                        .single();
                }
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

                    // Map Supabase row to bot format with both pnl and profit fields
                    closedTrades.push({
                        id: trade.market_id,
                        marketId: trade.market_id,
                        question: trade.question,
                        side: trade.side,
                        amount: amount,
                        entryPrice: trade.entry_price,
                        exitPrice: trade.exit_price,
                        pnl: pnl,
                        profit: pnl, // Alias for analytics compatibility
                        pnlPercent: trade.pnl_percent || (amount > 0 ? (pnl / amount * 100) : 0),
                        status: trade.status,
                        confidence: trade.confidence,
                        strategy: trade.strategy,
                        category: trade.category,
                        reasons: trade.metadata?.reasons || [],
                        closedAt: trade.updated_at || trade.created_at,
                        startTime: trade.created_at,
                        supabase_id: trade.id
                    });
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
                // Fix: Parse clobTokenIds if string (Railway bug)
                if (t.clobTokenIds && typeof t.clobTokenIds === 'string') {
                    try {
                        t.clobTokenIds = JSON.parse(t.clobTokenIds);
                    } catch (e) {
                        // If double encoded or bad format, try again or fail gracefully
                        try { t.clobTokenIds = JSON.parse(JSON.parse(t.clobTokenIds)); } catch (e2) { t.clobTokenIds = []; }
                    }
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

            // Recover AI Strategy from last simulation
            let recoveredParams = null;
            const { data: lastSim } = await supabase
                .from('simulation_runs')
                .select('metrics')
                //.eq('run_type', 'AUTO') // Removed filter to allow manual runs to count too
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (lastSim && lastSim.metrics) {
                recoveredParams = strategyAdapter.adapt(lastSim.metrics);
                console.log(`🧠 AI Strategy Restored: ${recoveredParams.mode}`);
            }

            return {
                capital: reconstructedCapital,
                totalTrades,
                winningTrades,
                losingTrades,
                activeTrades,
                closedTrades: closedTrades.slice(-50).reverse(), // Keep last 50, newest first
                logs: recoveredLogs.slice(0, 1000), // Synthetic logs for dashboard display
                recovered: true,
                learningParams: recoveredParams
            };


        } catch (err) {
            console.error("❌ Erreur reconstruction via Supabase:", err.message);
            return null;
        }
    }
};
