/**
 * MARKET DISCOVERY MODULE - Enhanced Gamma API Integration
 * Provides advanced market discovery with tags, pagination, and smart filtering
 */

const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Cache storage
const cache = new Map();

/**
 * Robust fetch wrapper
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
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
        }
    }
}

/**
 * Get cached data if valid
 */
function getCached(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
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
 * GET /tags - Fetch all available tags/categories
 * @returns {Array|null} Array of tags
 */
export async function fetchAvailableTags() {
    const cacheKey = 'gamma_tags';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const response = await fetchWithRetry(`${GAMMA_BASE_URL}/tags`);
        if (!response.ok) {
            throw new Error(`/tags returned ${response.status}`);
        }

        const tags = await response.json();
        if (Array.isArray(tags)) {
            setCache(cacheKey, tags);
            return tags;
        }

        return null;
    } catch (error) {
        console.error('❌ Tags fetch error:', error.message);
        return null;
    }
}

/**
 * GET /sports - Fetch sports metadata
 * @returns {Object|null} Sports data with tags
 */
export async function fetchSportsMetadata() {
    const cacheKey = 'gamma_sports';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const response = await fetchWithRetry(`${GAMMA_BASE_URL}/sports`);
        if (!response.ok) {
            throw new Error(`/sports returned ${response.status}`);
        }

        const sports = await response.json();
        setCache(cacheKey, sports);
        return sports;
    } catch (error) {
        console.error('❌ Sports fetch error:', error.message);
        return null;
    }
}

/**
 * GET /markets with enhanced filtering
 * @param {Object} options - Filter options
 * @returns {Array} Array of markets
 */
export async function getMarketsWithFilters(options = {}) {
    const {
        active = true,
        closed = false,
        limit = 200,
        offset = 0,
        tag_id = null,
        exclude_tag_id = null,
        order = null,
        ascending = false,
        related_tags = false
    } = options;

    // Build query string
    const params = new URLSearchParams();
    if (active !== null) params.append('active', active);
    if (closed !== null) params.append('closed', closed);
    params.append('limit', limit);
    if (offset > 0) params.append('offset', offset);
    if (tag_id) params.append('tag_id', tag_id);
    if (exclude_tag_id) params.append('exclude_tag_id', exclude_tag_id);
    if (order) {
        params.append('order', order);
        params.append('ascending', ascending);
    }
    if (related_tags) params.append('related_tags', 'true');

    const url = `${GAMMA_BASE_URL}/markets?${params.toString()}`;

    try {
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            throw new Error(`/markets returned ${response.status}`);
        }

        const markets = await response.json();
        return Array.isArray(markets) ? markets : [];
    } catch (error) {
        console.error('❌ Markets fetch error:', error.message);
        return [];
    }
}

/**
 * Paginate through ALL markets with configurable limit
 * @param {Object} filterOptions - Filter options for getMarketsWithFilters
 * @param {number} maxMarkets - Maximum number of markets to fetch (default 1000)
 * @returns {Array} Aggregated array of all markets
 */
export async function getAllMarketsWithPagination(filterOptions = {}, maxMarkets = 1000) {
    const cacheKey = `all_markets_${JSON.stringify(filterOptions)}_${maxMarkets}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const allMarkets = [];
    const batchSize = 200; // Max per request
    let offset = 0;
    let hasMore = true;

    console.log('🔍 Starting deep scan with pagination...');

    while (hasMore && allMarkets.length < maxMarkets) {
        const batch = await getMarketsWithFilters({
            ...filterOptions,
            limit: batchSize,
            offset
        });

        if (batch.length === 0) {
            hasMore = false;
        } else {
            allMarkets.push(...batch);
            offset += batchSize;

            // Log progress
            if (offset % 400 === 0) {
                console.log(`   Fetched ${allMarkets.length} markets so far...`);
            }

            // Stop if we got fewer results than requested (end of data)
            if (batch.length < batchSize) {
                hasMore = false;
            }
        }
    }

    console.log(`✅ Deep scan complete: ${allMarkets.length} markets found`);

    // Deduplicate by ID
    const uniqueMarkets = Array.from(
        new Map(allMarkets.map(m => [m.id, m])).values()
    );

    setCache(cacheKey, uniqueMarkets);
    return uniqueMarkets;
}

/**
 * Get markets filtered by multiple tags (OR logic)
 * @param {Array} tagIds - Array of tag IDs to include
 * @param {Object} additionalOptions - Additional filter options
 * @returns {Array} Markets matching any of the tags
 */
export async function getMarketsByTags(tagIds, additionalOptions = {}) {
    if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return [];
    }

    // Gamma API accepts comma-separated tag_ids
    const tagIdString = tagIds.join(',');

    return await getMarketsWithFilters({
        ...additionalOptions,
        tag_id: tagIdString
    });
}

/**
 * Get trending markets (high volume, high liquidity)
 * @param {number} limit - Number of markets to return
 * @returns {Array} Top trending markets
 */
export async function getTrendingMarkets(limit = 50) {
    const markets = await getMarketsWithFilters({
        active: true,
        closed: false,
        order: 'volume24hr',
        ascending: false,
        limit
    });

    // Additional filtering for quality and ACTIVE status
    return markets.filter(m => {
        const volume = parseFloat(m.volume24hr || 0);
        const liquidity = parseFloat(m.liquidityNum || 0);
        const isActive = new Date(m.endDate) > new Date();
        return volume > 1000 && liquidity > 500 && isActive;
    });
}

/**
 * Exclude sports markets (useful during high DEFCON)
 * @param {Object} options - Additional filter options
 * @returns {Array} Non-sports markets
 */
export async function getNonSportsMarkets(options = {}) {
    // Get sports tags first
    const sportsData = await fetchSportsMetadata();

    if (!sportsData || !Array.isArray(sportsData)) {
        // Fallback: just get all markets
        return await getMarketsWithFilters(options);
    }

    // Extract sport tag IDs
    const sportsTagIds = sportsData
        .filter(s => s.id || s.tag_id)
        .map(s => s.id || s.tag_id)
        .join(',');

    return await getMarketsWithFilters({
        ...options,
        exclude_tag_id: sportsTagIds
    });
}

/**
 * Smart market discovery based on DEFCON level
 * @param {number} defconLevel - Current DEFCON level (1-5)
 * @param {number} limit - Max markets to return
 * @returns {Array} Contextually relevant markets
 */
export async function getContextualMarkets(defconLevel, limit = 100) {
    const tags = await fetchAvailableTags();

    if (!tags || tags.length === 0) {
        // Fallback to trending
        return await getTrendingMarkets(limit);
    }

    // Map tag names to IDs
    const tagMap = new Map();
    tags.forEach(tag => {
        const name = (tag.label || tag.name || '').toLowerCase();
        tagMap.set(name, tag.id || tag.tag_id);
    });

    let targetTags = [];

    if (defconLevel <= 2) {
        // CRISIS MODE: Only geopolitical/economic
        targetTags = ['geopolitics', 'politics', 'economics', 'crypto', 'world']
            .map(name => tagMap.get(name))
            .filter(id => id);
    } else if (defconLevel === 3) {
        // ELEVATED: Mix of serious topics
        targetTags = ['geopolitics', 'politics', 'economics', 'crypto', 'business', 'world']
            .map(name => tagMap.get(name))
            .filter(id => id);
    } else {
        // NORMAL: Everything except sports during high alert
        return await getTrendingMarkets(limit);
    }

    if (targetTags.length === 0) {
        // No matching tags found, use trending
        return await getTrendingMarkets(limit);
    }

    const results = await getMarketsByTags(targetTags, {
        active: true,
        closed: false,
        order: 'volume24hr',
        ascending: false,
        limit
    });

    // STRICT FILTER: Remove expired markets
    return results.filter(m => new Date(m.endDate) > new Date());
}

/**
 * Get markets by slug (exact match)
 * @param {string} slug - Market slug
 * @returns {Object|null} Market data
 */
export async function getMarketBySlug(slug) {
    try {
        const response = await fetchWithRetry(`${GAMMA_BASE_URL}/markets/slug/${slug}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error(`❌ Market slug fetch error (${slug}):`, error.message);
        return null;
    }
}

/**
 * Get event by slug
 * @param {string} slug - Event slug
 * @returns {Object|null} Event data
 */
export async function getEventBySlug(slug) {
    try {
        const response = await fetchWithRetry(`${GAMMA_BASE_URL}/events/slug/${slug}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error(`❌ Event slug fetch error (${slug}):`, error.message);
        return null;
    }
}

export default {
    fetchAvailableTags,
    fetchSportsMetadata,
    getMarketsWithFilters,
    getAllMarketsWithPagination,
    getMarketsByTags,
    getTrendingMarkets,
    getNonSportsMarkets,
    getContextualMarkets,
    getMarketBySlug,
    getEventBySlug,
    getEventSlug
};

/**
 * Get event slug from market ID
 * @param {string} marketId 
 * @param {string} question 
 * @returns {Promise<string|null>}
 */
export async function getEventSlug(marketId, question) {
    try {
        if (!marketId) return null;
        const response = await fetchWithRetry(`${GAMMA_BASE_URL}/markets/${marketId}`);
        if (!response.ok) return null;
        const data = await response.json();
        if (data.events && data.events.length > 0 && data.events[0].slug) {
            return data.events[0].slug;
        }
        return data.slug || null;
    } catch (e) {
        return null; // Silent fail
    }
}
