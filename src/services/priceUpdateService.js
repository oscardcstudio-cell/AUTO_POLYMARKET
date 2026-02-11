import fetch from 'node-fetch';
import { addLog } from '../utils.js';
import { botState } from '../state.js';

/**
 * Price Update Service
 * Fetches current prices from Polymarket API with rate limiting protection
 */

const PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const PRICE_CACHE_DURATION = 4 * 60 * 1000; // 4 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// Cache to avoid redundant API calls
const priceCache = new Map();

/**
 * Fetch current price for a single market
 * @param {string} marketId - The market ID
 * @returns {Promise<number|null>} Current price or null if error
 */
async function fetchMarketPrice(marketId, retryCount = 0) {
    // Check cache first
    const cached = priceCache.get(marketId);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_DURATION) {
        return cached.price;
    }

    try {
        const url = `https://gamma-api.polymarket.com/markets/${marketId}`;
        const response = await fetch(url);

        if (response.status === 429) {
            // Rate limited - exponential backoff
            if (retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY * Math.pow(2, retryCount);
                addLog(botState, `⚠️ Rate limited, retrying in ${delay}ms...`, 'warning');
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchMarketPrice(marketId, retryCount + 1);
            }
            addLog(botState, `❌ Max retries reached for market ${marketId}`, 'error');
            return null;
        }

        if (!response.ok) {
            addLog(botState, `⚠️ Failed to fetch price for market ${marketId}: ${response.status}`, 'warning');
            return null;
        }

        const data = await response.json();

        // Extract current price (usually the YES token price)
        let currentPrice = null;
        let prices = data.outcomePrices;

        // PARSING FIX: Handle stringified JSON from Gamma API
        if (typeof prices === 'string') {
            try {
                prices = JSON.parse(prices);
            } catch (e) {
                prices = null;
            }
        }

        if (prices && Array.isArray(prices) && prices.length > 0) {
            currentPrice = parseFloat(prices[0]);
        } else if (data.clobTokenIds && data.clobTokenIds.length > 0) {
            // Fallback: If we had a CLOB client here we could use it, but for now just fail gracefully
            // or rely on what we have. If no prices, we can't update.
            currentPrice = null;
        }

        // Cache the result
        if (currentPrice !== null && !isNaN(currentPrice)) {
            priceCache.set(marketId, {
                price: currentPrice,
                timestamp: Date.now()
            });
        }

        return (currentPrice !== null && !isNaN(currentPrice)) ? currentPrice : null;
    } catch (error) {
        addLog(botState, `❌ Error fetching price for market ${marketId}: ${error.message}`, 'error');
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

    addLog(botState, `🔄 Updating prices for ${activeTrades.length} active trades...`);
    let updatedCount = 0;

    // Process trades sequentially with small delay to avoid rate limiting
    for (const trade of activeTrades) {
        if (!trade.marketId) {
            continue;
        }

        const currentPrice = await fetchMarketPrice(trade.marketId);

        if (currentPrice !== null) {
            // Initialize priceHistory if it doesn't exist
            if (!trade.priceHistory) {
                trade.priceHistory = [trade.entryPrice || currentPrice];
            }

            // Add new price to history
            trade.priceHistory.push(currentPrice);

            // Limit history to last 50 points to save memory
            if (trade.priceHistory.length > 50) {
                trade.priceHistory = trade.priceHistory.slice(-50);
            }

            // Update timestamp
            trade.lastPriceUpdate = new Date().toISOString();

            updatedCount++;
        }

        // Small delay between requests (200ms = max 5 req/sec = 300 req/min, well under limit)
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    addLog(botState, `✅ Updated ${updatedCount}/${activeTrades.length} trade prices`);
    return updatedCount;
}

/**
 * Start automatic price updates
 * @param {Object} botState - The bot state object with activeTrades
 * @returns {NodeJS.Timeout} Interval ID for cleanup
 */
export function startPriceUpdateLoop(botStateArg) {
    // Use the argument if provided, otherwise fallback to imported botState (though argument is expected)
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
    updateActiveTradePrices(botState.activeTrades);

    return intervalId;
}

/**
 * Clear price cache (for testing/debugging)
 */
export function clearPriceCache() {
    priceCache.clear();
    addLog(botState, '🗑️ Price cache cleared');
}
