
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';

// Safe wrapper — addLog can fail outside the full bot context (e.g. in test scripts)
function safeLog(msg) {
    try { addLog(msg); } catch { console.log(msg); }
}

// --- News cache to avoid hammering Google News ---
let newsCache = new Map(); // keyword -> { articles, timestamp }
const CACHE_TTL = CONFIG.NEWS?.CACHE_TTL_MS || 10 * 60 * 1000; // 10 min default

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
 * Simple XML tag extractor (no dependency needed for RSS).
 * Extracts all occurrences of <tagName>...</tagName> from xml string.
 */
function extractXmlTags(xml, tagName) {
    const results = [];
    const regex = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, 'gs');
    let match;
    while ((match = regex.exec(xml)) !== null) {
        results.push(match[1].trim());
    }
    return results;
}

/**
 * Basic sentiment analysis from headline text.
 * Returns: 'bullish' | 'bearish' | 'neutral'
 * Also returns a numeric score: -1.0 to +1.0
 */
function analyzeHeadlineSentiment(title) {
    const lower = title.toLowerCase();

    const bullishWords = [
        'surge', 'soar', 'rally', 'gain', 'rise', 'jump', 'boom', 'record high',
        'breakthrough', 'victory', 'win', 'approve', 'pass', 'deal', 'agree',
        'peace', 'recover', 'bullish', 'up', 'positive', 'optimis', 'strong',
        'beat', 'exceed', 'outperform', 'growth', 'expand', 'boost', 'accelerat',
        'milestone', 'success', 'secure', 'support', 'launch', 'advance'
    ];

    const bearishWords = [
        'crash', 'plunge', 'drop', 'fall', 'decline', 'slump', 'tank', 'collapse',
        'fail', 'reject', 'block', 'ban', 'sanction', 'war', 'attack', 'crisis',
        'threat', 'risk', 'fear', 'concern', 'bearish', 'down', 'negative', 'weak',
        'miss', 'disappoint', 'loss', 'cut', 'slash', 'suspend', 'halt', 'delay',
        'investigation', 'scandal', 'resign', 'fire', 'layoff', 'bankrupt', 'default',
        'flee', 'escalat', 'tension', 'strike', 'protest', 'riot'
    ];

    let score = 0;
    for (const w of bullishWords) {
        if (lower.includes(w)) score += 1;
    }
    for (const w of bearishWords) {
        if (lower.includes(w)) score -= 1;
    }

    // Normalize to -1..+1
    const normalized = Math.max(-1, Math.min(1, score / 3));
    const sentiment = normalized > 0.15 ? 'bullish' : normalized < -0.15 ? 'bearish' : 'neutral';

    return { sentiment, score: normalized };
}

/**
 * Fetch news from Google News RSS for a given query.
 * Returns array of { title, source, pubDate, sentiment, sentimentScore, link }
 */
async function fetchGoogleNewsRSS(query, maxArticles = 8) {
    const cacheKey = query.toLowerCase().trim();
    const cached = newsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.articles;
    }

    try {
        const encoded = encodeURIComponent(query);
        const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const xml = await response.text();

        // Parse <item> blocks from RSS (avoids channel-level and image title conflicts)
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        const items = [];
        let itemMatch;
        while ((itemMatch = itemRegex.exec(xml)) !== null) {
            items.push(itemMatch[1]);
        }

        const articles = [];
        for (let i = 0; i < Math.min(items.length, maxArticles); i++) {
            const itemXml = items[i];
            const titleArr = extractXmlTags(itemXml, 'title');
            const linkArr = extractXmlTags(itemXml, 'link');
            const pubDateArr = extractXmlTags(itemXml, 'pubDate');

            if (!titleArr[0]) continue;

            const rawTitle = titleArr[0]
                .replace(/<!\[CDATA\[/g, '')
                .replace(/\]\]>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");

            // Extract source from " - SourceName" at end of title
            const sourceSplit = rawTitle.split(' - ');
            const source = sourceSplit.length > 1 ? sourceSplit.pop().trim() : 'Unknown';
            const cleanTitle = sourceSplit.join(' - ').trim();

            const { sentiment, score } = analyzeHeadlineSentiment(cleanTitle);

            articles.push({
                title: cleanTitle,
                source,
                pubDate: pubDateArr[0] || null,
                sentiment,
                sentimentScore: score,
                link: (linkArr[0] || '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, ''),
            });
        }

        // Cache results
        newsCache.set(cacheKey, { articles, timestamp: Date.now() });

        return articles;
    } catch (e) {
        safeLog(`[News] Google News fetch failed for "${query}": ${e.message}`);
        return [];
    }
}

/**
 * Extract search keywords from a market question.
 * Filters out common/useless words and returns top entities.
 */
function extractSearchTerms(question) {
    const stopWords = new Set([
        'will', 'does', 'did', 'the', 'this', 'that', 'what', 'when', 'where',
        'which', 'who', 'how', 'have', 'has', 'had', 'been', 'being', 'would',
        'could', 'should', 'shall', 'might', 'must', 'need', 'with', 'from',
        'into', 'about', 'after', 'before', 'between', 'during', 'above', 'below',
        'more', 'less', 'than', 'over', 'under', 'each', 'every', 'both', 'either',
        'neither', 'other', 'another', 'such', 'only', 'also', 'just', 'then',
        'market', 'price', 'prediction', 'polymarket', 'happen', 'next', 'year',
        'month', 'week', 'february', 'march', 'april', 'january', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december', '2026',
        '2025', '2027', 'end', 'start', 'reach', 'going', 'likely', 'become',
        'announced', 'according', 'says', 'said', 'report', 'reports',
    ]);

    const words = question
        .replace(/[?!.,;:()"']/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

    // Deduplicate
    return [...new Set(words)].slice(0, 5);
}

/**
 * Aggregate sentiment for a specific topic from multiple articles.
 * Returns { sentiment, confidence, articleCount, avgScore, topHeadline }
 */
function aggregateSentiment(articles) {
    if (!articles || articles.length === 0) {
        return { sentiment: 'neutral', confidence: 0, articleCount: 0, avgScore: 0, topHeadline: null };
    }

    const totalScore = articles.reduce((sum, a) => sum + a.sentimentScore, 0);
    const avgScore = totalScore / articles.length;
    const bullishCount = articles.filter(a => a.sentiment === 'bullish').length;
    const bearishCount = articles.filter(a => a.sentiment === 'bearish').length;

    // Confidence based on agreement between articles
    const dominantCount = Math.max(bullishCount, bearishCount);
    const confidence = articles.length >= 3 ? dominantCount / articles.length : 0.3;

    const sentiment = avgScore > 0.1 ? 'bullish' : avgScore < -0.1 ? 'bearish' : 'neutral';

    return {
        sentiment,
        confidence: Math.round(confidence * 100) / 100,
        articleCount: articles.length,
        avgScore: Math.round(avgScore * 100) / 100,
        topHeadline: articles[0]?.title || null,
    };
}

/**
 * Fetch real news sentiment for a set of market keywords.
 * Groups keywords into 2-3 search queries to reduce API calls.
 * Returns array of sentiment objects compatible with botState.newsSentiment format.
 */
export async function fetchRealNewsSentiment(markets) {
    if (!markets || markets.length === 0) return [];

    // Collect unique search terms from top markets
    const allTerms = new Map(); // term -> count of markets mentioning it
    for (const m of markets.slice(0, 30)) {
        const terms = extractSearchTerms(m.question || '');
        for (const t of terms) {
            allTerms.set(t, (allTerms.get(t) || 0) + 1);
        }
    }

    // Pick top terms by frequency (most relevant across markets)
    const topTerms = [...allTerms.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, CONFIG.NEWS?.MAX_QUERIES || 6)
        .map(([term]) => term);

    if (topTerms.length === 0) return [];

    // Group into 2-3 queries of 2-3 terms each for efficiency
    const queries = [];
    for (let i = 0; i < topTerms.length; i += 2) {
        const group = topTerms.slice(i, i + 2);
        queries.push(group.join(' '));
    }

    // Fetch in parallel (max 3 concurrent)
    const results = [];
    const fetchPromises = queries.slice(0, 3).map(async (query) => {
        const articles = await fetchGoogleNewsRSS(query, 6);
        const agg = aggregateSentiment(articles);

        return {
            title: agg.topHeadline || `News: ${query}`,
            sentiment: agg.sentiment,
            sentimentScore: agg.avgScore,
            confidence: agg.confidence,
            articleCount: agg.articleCount,
            source: `Google News (${query})`,
            query,
            articles: articles.slice(0, 3), // Keep top 3 for display
        };
    });

    const sentiments = await Promise.all(fetchPromises);

    // Filter out empty results
    for (const s of sentiments) {
        if (s.articleCount > 0) results.push(s);
    }

    // Also add trending topics scan
    try {
        const trendArticles = await fetchGoogleNewsRSS('Polymarket prediction market', 5);
        if (trendArticles.length > 0) {
            const agg = aggregateSentiment(trendArticles);
            results.push({
                title: agg.topHeadline || 'Polymarket Trends',
                sentiment: agg.sentiment,
                sentimentScore: agg.avgScore,
                confidence: agg.confidence,
                articleCount: agg.articleCount,
                source: 'Google News (Polymarket)',
                query: 'Polymarket prediction market',
                articles: trendArticles.slice(0, 3),
            });
        }
    } catch { /* ignore trend fetch failure */ }

    safeLog(`[News] Fetched ${results.length} sentiment groups from ${queries.length} queries (${results.reduce((s, r) => s + r.articleCount, 0)} articles total)`);

    return results;
}

/**
 * Check if a market's topic matches any fetched news sentiment.
 * Returns { matched: bool, sentiment, score, headline } or null.
 */
export function matchMarketToNews(market, newsSentiments) {
    if (!newsSentiments || newsSentiments.length === 0 || !market?.question) return null;

    const keywords = extractSearchTerms(market.question);
    if (keywords.length === 0) return null;

    for (const ns of newsSentiments) {
        // Check if any keyword appears in the news articles
        const allText = [ns.title, ...(ns.articles || []).map(a => a.title)].join(' ').toLowerCase();
        const matchCount = keywords.filter(k => allText.includes(k.toLowerCase())).length;

        if (matchCount >= 2 || (matchCount >= 1 && keywords.length <= 2)) {
            return {
                matched: true,
                sentiment: ns.sentiment,
                score: ns.sentimentScore,
                confidence: ns.confidence,
                headline: ns.title,
                source: ns.source,
            };
        }
    }

    return null;
}

/**
 * Clear the news cache (useful for testing or forced refresh).
 */
export function clearNewsCache() {
    newsCache.clear();
}

// Export for testing
export { fetchGoogleNewsRSS, analyzeHeadlineSentiment, extractSearchTerms, aggregateSentiment };
