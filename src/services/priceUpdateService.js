import { fetchWithRetry, addLog } from '../utils.js';
import { botState } from '../state.js';
import { getMidPrice } from '../api/clob_api.js';

/**
 * Price Update Service
 * Uses CLOB API (real-time) with Gamma API fallback
 * Respects trade side (YES/NO) for correct pricing
 */

const PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const GAMMA_CACHE_DURATION = 4 * 60 * 1000; // 4 minutes

// Cache for Gamma fallback only (CLOB has its own 30s cache)
const gammaCache = new Map();

/**
 * Fetch current price for a trade using CLOB first, then Gamma fallback
 * @param {Object} trade - The trade object (needs clobTokenIds, side, marketId)
 * @returns {Promise<number|null>} Current price or null if error
 */
async function fetchTradePrice(trade) {
    // --- 1. Try CLOB API first (most accurate, real-time) ---
    try {
        let tokenIds = trade.clobTokenIds;
        if (typeof tokenIds === 'string') {
            try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = null; }
        }
        if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
            const tokenId = trade.side === 'YES' ? tokenIds[0] : tokenIds[1];
            if (tokenId && typeof tokenId === 'string' && tokenId.length > 10) {
                const clobPrice = await getMidPrice(tokenId);
                if (clobPrice && clobPrice > 0 && clobPrice <= 1) {
                    return clobPrice;
                }
            }
        }
    } catch (e) {
        // CLOB failed, try Gamma fallback
    }

    // --- 2. Fallback to Gamma API (respecting YES/NO side) ---
    const cacheKey = `${trade.marketId}_${trade.side}`;
    const cached = gammaCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GAMMA_CACHE_DURATION) {
        return cached.price;
    }

    try {
        const url = `https://gamma-api.polymarket.com/markets/${trade.marketId}`;
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        let prices = data.outcomePrices;
        if (typeof prices === 'string') {
            try { prices = JSON.parse(prices); } catch { prices = null; }
        }

        if (prices && Array.isArray(prices) && prices.length >= 2) {
            // Pick the correct side: YES = prices[0], NO = prices[1]
            const price = trade.side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
            if (!isNaN(price) && price >= 0 && price <= 1) {
                gammaCache.set(cacheKey, { price, timestamp: Date.now() });
                return price;
            }
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Update prices for all active trades
 * @param {Array} activeTrades - Array of active trade objects
 * @returns {Promise<number>} Number of trades updated
 */
export async function updateActiveTradePrices(activeTrades) {
    if (!activeTrades || activeTrades.length === 0) {
        return 0;
    }

    let updatedCount = 0;

    // Process trades in parallel batches of 5 to avoid rate limiting
    const BATCH_SIZE = 5;
    const tradesToUpdate = activeTrades.filter(t => t.marketId);

    for (let i = 0; i < tradesToUpdate.length; i += BATCH_SIZE) {
        const batch = tradesToUpdate.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(batch.map(async (trade) => {
            const currentPrice = await fetchTradePrice(trade);

            if (currentPrice !== null) {
                if (!trade.priceHistory) {
                    trade.priceHistory = [trade.entryPrice || currentPrice];
                }
                trade.priceHistory.push(currentPrice);
                if (trade.priceHistory.length > 50) {
                    trade.priceHistory = trade.priceHistory.slice(-50);
                }
                trade.lastPriceUpdate = new Date().toISOString();
                return true;
            }
            return false;
        }));

        updatedCount += results.filter(Boolean).length;

        // Small delay between batches to respect rate limits
        if (i + BATCH_SIZE < tradesToUpdate.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    if (updatedCount > 0) {
        addLog(botState, `📊 Price update: ${updatedCount}/${tradesToUpdate.length} trades refreshed`);
    }
    return updatedCount;
}

/**
 * Start automatic price updates
 * @param {Object} botStateArg - The bot state object with activeTrades
 * @returns {NodeJS.Timeout} Interval ID for cleanup
 */
export function startPriceUpdateLoop(botStateArg) {
    const state = botStateArg || botState;
    addLog(state, `🚀 Starting price update loop (every ${PRICE_UPDATE_INTERVAL / 60000} minutes)`);

    const intervalId = setInterval(async () => {
        try {
            await updateActiveTradePrices(state.activeTrades);
        } catch (error) {
            addLog(state, `❌ Price update loop error: ${error.message}`, 'error');
        }
    }, PRICE_UPDATE_INTERVAL);

    // Initial update
    updateActiveTradePrices(state.activeTrades);

    return intervalId;
}

/**
 * Clear price cache (for testing/debugging)
 */
export function clearPriceCache() {
    gammaCache.clear();
    addLog(botState, '🗑️ Price cache cleared');
}
