/**
 * CLOB API MODULE - Polymarket Central Limit Order Book
 * Provides real-time order book, pricing, and trade history data
 * Base URL: https://clob.polymarket.com
 */

const CLOB_BASE_URL = 'https://clob.polymarket.com';
const CACHE_TTL_ORDER_BOOK = 30000; // 30 seconds
const CACHE_TTL_TRADES = 300000; // 5 minutes

// Cache storage
const cache = new Map();

/**
 * Robust fetch wrapper with retry logic
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeout = 20000;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    ...options.headers
                }
            });

            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            const isLastAttempt = attempt === retries;

            if (isLastAttempt) {
                throw error;
            }

            // Don't retry on 401/403 (Auth failure)
            if (error.message.includes('401') || error.message.includes('403')) {
                throw error;
            }

            const delay = Math.pow(2, attempt - 1) * 1000;
            console.log(`⚠️ CLOB fetch attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

let hasLoggedAuthError = false; // Prevent log spam

/**
 * Get cached data if valid, otherwise return null
 */
function getCached(key, ttl) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.data;
    }
    return null;
}

/**
 * Set cached data
 */
function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

/**
 * GET /book - Retrieve order book for a specific token
 * @param {string} tokenId - The token ID (outcome token ID from market)
 * @returns {Object|null} Order book with bids and asks
 */
export async function getCLOBOrderBook(tokenId) {
    const cacheKey = `book_${tokenId}`;
    const cached = getCached(cacheKey, CACHE_TTL_ORDER_BOOK);
    if (cached) return cached;

    try {
        const url = `${CLOB_BASE_URL}/book?token_id=${tokenId}`;
        const response = await fetchWithRetry(url);

        if (response.status === 404) {
            return null;
        }

        if (response.status === 401 || response.status === 403) {
            if (!hasLoggedAuthError) {
                console.warn(`⚠️ CLOB Access Denied (${response.status}). Public data might be restricted. Disabling CLOB calls.`);
                hasLoggedAuthError = true;
            }
            return null;
        }

        if (!response.ok) {
            throw new Error(`CLOB /book returned ${response.status}`);
        }

        const data = await response.json();

        // Validate response structure
        if (data && data.bids && data.asks) {
            setCache(cacheKey, data);
            return data;
        }

        return null;
    } catch (error) {
        if (!error.message.includes('404')) {
            console.warn(`⚠️ CLOB Order Book Warning (${tokenId}): ${error.message}`);
        }
        return null;
    }
}

/**
 * GET /price - Get current price for a token
 * @param {string} tokenId - The token ID
 * @param {string} side - 'BUY' or 'SELL' (required by CLOB API)
 * @returns {number|null} Current price
 */
export async function getCLOBPrice(tokenId, side = 'BUY') {
    const cacheKey = `price_${tokenId}_${side}`;
    const cached = getCached(cacheKey, CACHE_TTL_ORDER_BOOK);
    if (cached) return cached;

    try {
        const url = `${CLOB_BASE_URL}/price?token_id=${tokenId}&side=${side}`;
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(`CLOB /price returned ${response.status}`);
        }

        const data = await response.json();
        const price = parseFloat(data.price);

        if (price >= 0 && price <= 1) {
            setCache(cacheKey, price);
            return price;
        }

        return null;
    } catch (error) {
        if (error.message.includes('401') || error.message.includes('403')) return null;
        return null;
    }
}

/**
 * GET /midpoint - Get midpoint price for a token
 * @param {string} tokenId - The token ID
 * @returns {number|null} Midpoint price
 */
export async function getCLOBMidpoint(tokenId) {
    const cacheKey = `midpoint_${tokenId}`;
    const cached = getCached(cacheKey, CACHE_TTL_ORDER_BOOK);
    if (cached) return cached;

    try {
        const url = `${CLOB_BASE_URL}/midpoint?token_id=${tokenId}`;
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(`CLOB /midpoint returned ${response.status}`);
        }

        const data = await response.json();
        const midpoint = parseFloat(data.mid);

        if (midpoint >= 0 && midpoint <= 1) {
            setCache(cacheKey, midpoint);
            return midpoint;
        }

        return null;
    } catch (error) {
        if (error.message.includes('401') || error.message.includes('403')) return null;
        console.error(`❌ CLOB Midpoint Error (${tokenId}):`, error.message);
        return null;
    }
}

/**
 * GET /trades - Get trade history for a market
 * @param {string} marketId - The market ID (condition ID)
 * @returns {Array|null} Array of recent trades
 */
export async function getCLOBTradeHistory(marketId) {
    const cacheKey = `trades_${marketId}`;
    const cached = getCached(cacheKey, CACHE_TTL_TRADES);
    if (cached) return cached;

    try {
        const url = `${CLOB_BASE_URL}/trades?market=${marketId}`;
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(`CLOB /trades returned ${response.status}`);
        }

        const trades = await response.json();

        if (Array.isArray(trades)) {
            setCache(cacheKey, trades);
            return trades;
        }

        return null;
    } catch (error) {
        if (error.message.includes('401') || error.message.includes('403')) return null;
        console.error(`❌ CLOB Trades Error (${marketId}):`, error.message);
        return null;
    }
}

/**
 * GET /markets - Get all markets with order book data
 * @returns {Array|null} Array of markets
 */
export async function getCLOBMarkets() {
    const cacheKey = 'clob_markets';
    const cached = getCached(cacheKey, CACHE_TTL_TRADES);
    if (cached) return cached;

    try {
        const url = `${CLOB_BASE_URL}/markets`;
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(`CLOB /markets returned ${response.status}`);
        }

        const result = await response.json();

        // CLOB API returns {data: [...]} format
        const markets = result.data || result;

        if (Array.isArray(markets)) {
            setCache(cacheKey, markets);
            return markets;
        }

        return null;
    } catch (error) {
        console.error(`❌ CLOB Markets Error:`, error.message);
        return null;
    }
}

/**
 * Calculate bid/ask spread from order book
 * @param {Object} orderBook - Order book from getCLOBOrderBook
 * @returns {Object} Spread analysis
 */
export function analyzeSpread(orderBook) {
    if (!orderBook || !orderBook.bids || !orderBook.asks) {
        return null;
    }

    const bids = orderBook.bids;
    const asks = orderBook.asks;

    if (bids.length === 0 || asks.length === 0) {
        return {
            spread: 0,
            spreadPercent: 0,
            liquidity: 'none',
            warning: 'No bids or asks available'
        };
    }

    const bestBid = parseFloat(bids[0].price);
    const bestAsk = parseFloat(asks[0].price);
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPercent = (spread / midPrice) * 100;

    // Calculate liquidity depth (total size at best prices)
    const bidSize = parseFloat(bids[0].size || 0);
    const askSize = parseFloat(asks[0].size || 0);

    let liquidity = 'low';
    if (bidSize > 100 && askSize > 100) liquidity = 'high';
    else if (bidSize > 50 && askSize > 50) liquidity = 'medium';

    let warning = null;
    if (spreadPercent > 5) warning = 'High slippage risk (spread > 5%)';
    if (spreadPercent > 10) warning = 'CRITICAL: Spread > 10%, avoid trading';

    return {
        bestBid,
        bestAsk,
        midPrice,
        spread: spread.toFixed(4),
        spreadPercent: spreadPercent.toFixed(2),
        bidSize,
        askSize,
        liquidity,
        warning
    };
}

/**
 * Get best execution price with spread awareness
 * @param {string} tokenId - Token ID
 * @param {string} side - 'buy' or 'sell'
 * @returns {Object|null} Execution price info
 */
export async function getBestExecutionPrice(tokenId, side = 'buy') {
    try {
        const orderBook = await getCLOBOrderBook(tokenId);
        if (!orderBook) return null;

        const spreadInfo = analyzeSpread(orderBook);
        if (!spreadInfo) return null;

        // Use ask price for buying, bid price for selling
        const executionPrice = side === 'buy' ? spreadInfo.bestAsk : spreadInfo.bestBid;

        return {
            price: executionPrice,
            midPrice: spreadInfo.midPrice,
            spread: spreadInfo.spread,
            spreadPercent: spreadInfo.spreadPercent,
            liquidity: spreadInfo.liquidity,
            warning: spreadInfo.warning,
            source: 'CLOB'
        };
    } catch (error) {
        console.error(`❌ Execution Price Error:`, error.message);
        return null;
    }
}

/**
 * Health check for CLOB API
 * @returns {boolean} True if CLOB is online
 */
export async function checkCLOBHealth() {
    try {
        const url = `${CLOB_BASE_URL}/ok`;
        const response = await fetchWithRetry(url, {}, 1); // Only 1 retry for health check
        return response.ok;
    } catch (error) {
        return false;
    }
}

export { getCLOBMidpoint as getMidPrice };

export default {
    getCLOBOrderBook,
    getCLOBPrice,
    getCLOBMidpoint,
    getMidPrice: getCLOBMidpoint,
    getCLOBTradeHistory,
    getCLOBMarkets,
    analyzeSpread,
    getBestExecutionPrice,
    checkCLOBHealth
};
