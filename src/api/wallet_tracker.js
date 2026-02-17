
import { CONFIG } from '../config.js';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { supabaseService, supabase } from '../services/supabaseService.js';

const DATA_API = 'https://data-api.polymarket.com';

// Caches
let leaderboardCache = { data: null, timestamp: 0 };
let positionsCache = {}; // { walletAddress: { data, timestamp } }

async function fetchWithTimeout(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

// ========== LEADERBOARD ==========

/**
 * Fetch top traders from Polymarket leaderboard.
 * Returns array of { wallet, username, pnl, volume, rank, category }.
 */
export async function fetchLeaderboard(category = 'OVERALL', timePeriod = 'WEEK', limit = 50) {
    const CT = CONFIG.COPY_TRADING || {};
    const cacheTTL = CT.LEADERBOARD_CACHE_TTL_MS || 6 * 60 * 60 * 1000; // 6h default

    const cacheKey = `${category}_${timePeriod}`;
    if (leaderboardCache.data && leaderboardCache.key === cacheKey && (Date.now() - leaderboardCache.timestamp) < cacheTTL) {
        return leaderboardCache.data;
    }

    try {
        const url = `${DATA_API}/v1/leaderboard?category=${category}&timePeriod=${timePeriod}&orderBy=PNL&limit=${limit}`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const traders = data.map((t, i) => ({
            wallet: t.proxyWallet,
            username: t.userName || t.pseudonym || `Trader_${i + 1}`,
            pnl: t.pnl || 0,
            volume: t.vol || 0,
            rank: t.rank || i + 1,
            profileImage: t.profileImage || null,
        }));

        leaderboardCache = { data: traders, timestamp: Date.now(), key: cacheKey };
        return traders;

    } catch (e) {
        console.error(`[WalletTracker] Leaderboard fetch failed: ${e.message}`);
        return leaderboardCache.data || [];
    }
}

// ========== WALLET POSITIONS ==========

/**
 * Fetch current positions for a wallet.
 * Returns array of { conditionId, title, slug, size, avgPrice, currentValue, cashPnL, percentPnL, outcome }.
 */
export async function fetchWalletPositions(walletAddress) {
    const CT = CONFIG.COPY_TRADING || {};
    const cacheTTL = CT.POSITION_CHECK_INTERVAL_MS || 5 * 60 * 1000;

    const cached = positionsCache[walletAddress];
    if (cached && (Date.now() - cached.timestamp) < cacheTTL) {
        return cached.data;
    }

    try {
        const url = `${DATA_API}/positions?user=${walletAddress}&limit=500&sizeThreshold=1.0`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const positions = data.map(p => ({
            conditionId: p.conditionId,
            title: p.title || '',
            slug: p.slug || '',
            size: p.size || 0,
            avgPrice: p.averagePrice || 0,
            currentValue: p.currentValue || 0,
            initialValue: p.initialValue || 0,
            cashPnL: p.cashPnL || 0,
            percentPnL: p.percentPnL || 0,
            outcome: p.outcome || '',
            proxyWallet: p.user || walletAddress,
        }));

        positionsCache[walletAddress] = { data: positions, timestamp: Date.now() };
        return positions;

    } catch (e) {
        console.error(`[WalletTracker] Positions fetch failed for ${walletAddress.substring(0, 10)}...: ${e.message}`);
        return positionsCache[walletAddress]?.data || [];
    }
}

// ========== COPY TRADE DETECTION ==========

/**
 * Compare current positions vs last known positions for a wallet.
 * Returns new positions (ones that didn't exist before).
 */
function detectNewPositions(currentPositions, previousPositions) {
    if (!previousPositions || previousPositions.length === 0) return [];

    const prevMap = new Map(previousPositions.map(p => [p.conditionId + '_' + p.outcome, p]));
    const newPositions = [];

    for (const pos of currentPositions) {
        const key = pos.conditionId + '_' + pos.outcome;
        const prev = prevMap.get(key);

        if (!prev) {
            // Completely new position
            newPositions.push({ ...pos, type: 'NEW' });
        } else if (pos.size > prev.size * 1.2) {
            // Significant size increase (>20%) = adding to position
            newPositions.push({ ...pos, type: 'ADD', previousSize: prev.size });
        }
    }

    return newPositions;
}

// ========== TRACKED WALLETS MANAGEMENT ==========

/**
 * Update tracked wallets from leaderboard.
 * Stores top N wallets with their performance metrics.
 */
export async function refreshTrackedWallets() {
    const CT = CONFIG.COPY_TRADING || {};
    if (!CT.ENABLED) return;

    try {
        const categories = CT.CATEGORIES || ['OVERALL'];
        const maxWallets = CT.MAX_TRACKED_WALLETS || 20;

        let allTraders = [];
        for (const cat of categories) {
            const traders = await fetchLeaderboard(cat, 'WEEK', 50);
            allTraders.push(...traders.map(t => ({ ...t, category: cat })));
        }

        // Deduplicate by wallet, keep best rank
        const walletMap = new Map();
        for (const t of allTraders) {
            if (!walletMap.has(t.wallet) || t.pnl > walletMap.get(t.wallet).pnl) {
                walletMap.set(t.wallet, t);
            }
        }

        // Filter by minimum PnL and sort
        const minPnL = CT.MIN_WALLET_PNL_7D || 500;
        const qualified = Array.from(walletMap.values())
            .filter(t => t.pnl >= minPnL)
            .sort((a, b) => b.pnl - a.pnl)
            .slice(0, maxWallets);

        // Store in botState
        botState.trackedWallets = qualified.map(t => ({
            wallet: t.wallet,
            username: t.username,
            pnl7d: t.pnl,
            volume7d: t.volume,
            rank: t.rank,
            category: t.category,
            lastChecked: null,
            lastPositions: null,
            performance: {
                copiedTrades: 0,
                copiedPnL: 0,
                hitRate: 0,
            },
        }));

        // Save to Supabase if available
        if (supabase) {
            try {
                await supabase.from('tracked_wallets').upsert(
                    qualified.map(t => ({
                        wallet_address: t.wallet,
                        username: t.username,
                        rank: t.rank,
                        category: t.category,
                        pnl_7d: t.pnl,
                        volume_7d: t.volume,
                        is_active: true,
                        last_updated: new Date().toISOString(),
                    })),
                    { onConflict: 'wallet_address' }
                );
            } catch (e) {
                console.warn(`[WalletTracker] Supabase save failed: ${e.message}`);
            }
        }

        addLog(botState, `[CopyTrade] Tracked ${qualified.length} wallets (min PnL $${minPnL}, top: ${qualified[0]?.username || 'N/A'} $${Math.round(qualified[0]?.pnl || 0)})`, 'info');

        return qualified;

    } catch (e) {
        console.error(`[WalletTracker] Refresh tracked wallets failed: ${e.message}`);
        return [];
    }
}

/**
 * Scan all tracked wallets for new positions (copy trade signals).
 * Returns array of copy signals: { wallet, username, position, walletPnL }.
 */
export async function scanCopySignals() {
    const CT = CONFIG.COPY_TRADING || {};
    if (!CT.ENABLED) return [];

    const tracked = botState.trackedWallets || [];
    if (tracked.length === 0) return [];

    const copySignals = [];
    const minTradeSize = CT.MIN_SOURCE_TRADE_SIZE || 500;

    // Limit concurrent requests to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < tracked.length; i += batchSize) {
        const batch = tracked.slice(i, i + batchSize);

        const results = await Promise.allSettled(
            batch.map(async (tw) => {
                const positions = await fetchWalletPositions(tw.wallet);

                // Detect new positions vs last known
                const newPositions = detectNewPositions(positions, tw.lastPositions);

                // Update last known positions
                tw.lastPositions = positions;
                tw.lastChecked = new Date().toISOString();

                // Filter signals
                for (const pos of newPositions) {
                    // Only copy positions above minimum size
                    if (pos.initialValue < minTradeSize) continue;
                    // Only copy positions with positive direction (trader believes in it)
                    if (pos.percentPnL < -20) continue; // Don't copy losing trades

                    copySignals.push({
                        wallet: tw.wallet,
                        username: tw.username,
                        walletPnL: tw.pnl7d,
                        walletRank: tw.rank,
                        position: pos,
                        signalType: pos.type, // NEW or ADD
                        timestamp: Date.now(),
                    });
                }
            })
        );

        // Small delay between batches to be polite to the API
        if (i + batchSize < tracked.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    if (copySignals.length > 0) {
        addLog(botState, `[CopyTrade] ${copySignals.length} new signals from ${tracked.length} wallets`, 'info');
    }

    return copySignals;
}

/**
 * Match a copy signal to a market in our available markets list.
 * Returns the matched market or null.
 */
export function matchCopySignalToMarket(signal, availableMarkets) {
    if (!signal?.position?.conditionId || !availableMarkets) return null;

    // Direct match by conditionId
    for (const m of availableMarkets) {
        const mConditionId = m.conditionID || m.conditionId || '';
        if (mConditionId === signal.position.conditionId) return m;
    }

    // Slug match
    if (signal.position.slug) {
        for (const m of availableMarkets) {
            if (m.slug === signal.position.slug) return m;
        }
    }

    // Title fuzzy match (last resort)
    if (signal.position.title) {
        const signalWords = signal.position.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        for (const m of availableMarkets) {
            if (!m.question) continue;
            const mTitle = m.question.toLowerCase();
            const matchCount = signalWords.filter(w => mTitle.includes(w)).length;
            if (matchCount >= 3 || (matchCount >= 2 && signalWords.length <= 4)) {
                return m;
            }
        }
    }

    return null;
}

/**
 * Clear all caches (for testing or forced refresh).
 */
export function clearWalletCaches() {
    leaderboardCache = { data: null, timestamp: 0 };
    positionsCache = {};
}
