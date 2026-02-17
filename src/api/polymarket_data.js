
import { CONFIG } from '../config.js';

const DATA_API = 'https://data-api.polymarket.com';

// Cache to avoid spamming the API
let whaleTradesCache = { data: null, timestamp: 0 };
const CACHE_TTL = CONFIG.WHALE_TRACKING?.CACHE_TTL_MS || 5 * 60 * 1000; // 5 min

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

/**
 * Fetch recent large trades from Polymarket Data API.
 * Returns trades grouped by market with whale intelligence.
 */
export async function fetchWhaleTrades() {
    const now = Date.now();
    if (whaleTradesCache.data && (now - whaleTradesCache.timestamp) < CACHE_TTL) {
        return whaleTradesCache.data;
    }

    try {
        const minSize = CONFIG.WHALE_TRACKING?.MIN_WHALE_SIZE || 500;
        // Fetch a large batch and filter for big trades
        const res = await fetchWithTimeout(`${DATA_API}/trades?limit=500`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const allTrades = await res.json();

        // Filter whale trades (>= minSize)
        const whaleTrades = allTrades.filter(t => t.size >= minSize);

        // Group by market (conditionId)
        const byMarket = {};
        for (const t of whaleTrades) {
            const key = t.conditionId;
            if (!key) continue;
            if (!byMarket[key]) {
                byMarket[key] = {
                    conditionId: key,
                    title: t.title,
                    slug: t.slug,
                    eventSlug: t.eventSlug,
                    icon: t.icon,
                    trades: [],
                    totalVolume: 0,
                    buyVolume: 0,
                    sellVolume: 0,
                    whaleCount: 0,
                    topTrade: null,
                };
            }
            const mkt = byMarket[key];
            mkt.trades.push({
                wallet: t.proxyWallet,
                name: t.pseudonym || t.name,
                side: t.side,
                size: t.size,
                price: t.price,
                outcome: t.outcome,
                timestamp: t.timestamp,
            });
            mkt.totalVolume += t.size;
            if (t.side === 'BUY') mkt.buyVolume += t.size;
            else mkt.sellVolume += t.size;
            mkt.whaleCount++;
            if (!mkt.topTrade || t.size > mkt.topTrade.size) {
                mkt.topTrade = { name: t.pseudonym || t.name, side: t.side, size: t.size, price: t.price, outcome: t.outcome };
            }
        }

        // Compute whale consensus per market
        for (const mkt of Object.values(byMarket)) {
            const buyRatio = mkt.totalVolume > 0 ? mkt.buyVolume / mkt.totalVolume : 0.5;
            mkt.consensus = buyRatio > 0.65 ? 'BULLISH' : buyRatio < 0.35 ? 'BEARISH' : 'MIXED';
            mkt.buyRatio = Math.round(buyRatio * 100);
        }

        // Sort by total whale volume
        const sorted = Object.values(byMarket).sort((a, b) => b.totalVolume - a.totalVolume);

        const result = {
            markets: sorted,
            totalWhaleTrades: whaleTrades.length,
            totalVolume: whaleTrades.reduce((s, t) => s + t.size, 0),
            scanSize: allTrades.length,
            timestamp: now,
        };

        whaleTradesCache = { data: result, timestamp: now };
        return result;

    } catch (e) {
        console.error(`[WhaleTracker] Fetch failed: ${e.message}`);
        return whaleTradesCache.data || { markets: [], totalWhaleTrades: 0, totalVolume: 0, scanSize: 0, timestamp: now };
    }
}

/**
 * Fetch activity for a specific wallet address.
 * Used to deep-dive into a whale's recent positions.
 */
export async function fetchWalletActivity(walletAddress, limit = 10) {
    try {
        const res = await fetchWithTimeout(`${DATA_API}/activity?user=${walletAddress}&limit=${limit}&type=TRADE`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`[WhaleTracker] Wallet activity failed: ${e.message}`);
        return [];
    }
}

/**
 * Match whale data to a specific market by slug or conditionId.
 * Returns whale intelligence for that market or null.
 */
export function matchWhaleToMarket(market, whaleData) {
    if (!whaleData?.markets || !market) return null;

    // Try matching by slug first (most reliable)
    const slug = market.slug || '';
    const conditionId = market.conditionID || market.conditionId || '';

    for (const wm of whaleData.markets) {
        if ((slug && wm.slug === slug) ||
            (slug && wm.eventSlug === slug) ||
            (conditionId && wm.conditionId === conditionId)) {
            return wm;
        }
    }

    // Fuzzy match by title keywords
    if (market.question) {
        const marketWords = market.question.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        for (const wm of whaleData.markets) {
            const whaleTitle = (wm.title || '').toLowerCase();
            const matchCount = marketWords.filter(w => whaleTitle.includes(w)).length;
            if (matchCount >= 3 || (matchCount >= 2 && marketWords.length <= 4)) {
                return wm;
            }
        }
    }

    return null;
}

/**
 * Clear the whale trades cache (for testing or forced refresh).
 */
export function clearWhaleCache() {
    whaleTradesCache = { data: null, timestamp: 0 };
}
