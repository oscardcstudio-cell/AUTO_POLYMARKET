
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';
import { getTrendingMarkets, getContextualMarkets, fetchAvailableTags, getAllMarketsWithPagination } from '../api/market_discovery.js';
import { fetchRealNewsSentiment, matchMarketToNews } from '../api/news.js';
import { fetchWhaleTrades, matchWhaleToMarket } from '../api/polymarket_data.js';

// Helper for inline fetches in getRelevantMarkets
async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeout = 20000;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
    }
}

let relevantMarketsCache = null;
let lastRelevantScanCalls = 0;

export async function getRelevantMarkets(useDeepScan = false) {
    try {
        // Simple cache check
        const tsNow = Date.now();
        if (relevantMarketsCache && (tsNow - lastRelevantScanCalls < 60000) && !useDeepScan) {
            return relevantMarketsCache;
        }

        const tension = botState.lastPizzaData?.tensionScore || 0;
        const T = CONFIG.TENSION || {};

        // Crisis Mode: Full lockdown at CRITICAL tension
        if (tension >= (T.CRITICAL || 80)) {
            const contextualMarkets = await getContextualMarkets(1, 100);
            addLog(botState, `🚨 CRISIS MODE (tension ${tension}/100): ${contextualMarkets.length} geo/eco markets only`, 'warning');
            return contextualMarkets;
        }

        // High tension: log it but keep all markets (scoring handles the bias)
        if (tension >= (T.HIGH || 55)) {
            addLog(botState, `HIGH TENSION (${tension}/100): Boosting geo/eco scoring`, 'info');
        }

        let mergedMarkets;

        if (useDeepScan) {
            // REAL DEEP SCAN: paginate up to 600 markets across volume + liquidity sorts
            const [byVolume, byLiquidity] = await Promise.all([
                getAllMarketsWithPagination({ active: true, closed: false, order: 'volume24hr', ascending: false }, 400),
                getAllMarketsWithPagination({ active: true, closed: false, order: 'liquidityNum', ascending: false }, 400)
            ]);

            const uniqueMap = new Map();
            [...byVolume, ...byLiquidity].forEach(m => {
                if (m && m.id) uniqueMap.set(m.id, m);
            });
            mergedMarkets = Array.from(uniqueMap.values());
        } else {
            // Quick scan: 100 trending + 5 category tags (50 each)
            const p1 = getTrendingMarkets(100);
            const p2 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&tag_id=1').then(r => r.json()).catch(() => []); // Politics
            const p3 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&tag_id=2').then(r => r.json()).catch(() => []); // Economics
            const p4 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&tag_id=3').then(r => r.json()).catch(() => []); // Tech
            const p5 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&tag_id=4').then(r => r.json()).catch(() => []); // Sports
            const p6 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&tag_id=6').then(r => r.json()).catch(() => []); // Crypto

            const [trending, politics, eco, tech, sports, crypto] = await Promise.all([p1, p2, p3, p4, p5, p6]);

            const uniqueMap = new Map();
            [...(Array.isArray(trending) ? trending : []),
            ...(Array.isArray(politics) ? politics : []),
            ...(Array.isArray(eco) ? eco : []),
            ...(Array.isArray(tech) ? tech : []),
            ...(Array.isArray(sports) ? sports : []),
            ...(Array.isArray(crypto) ? crypto : [])].forEach(m => {
                if (m && m.id) uniqueMap.set(m.id, m);
            });
            mergedMarkets = Array.from(uniqueMap.values());
        }

        // Filter: liquidity, expiry, AND tradeable price range
        const dateNow = new Date();
        const filtered = mergedMarkets.filter(m => {
            const hasLiquidity = parseFloat(m.liquidityNum || 0) > 100;
            const expiry = new Date(m.endDate);
            const daysToExpiry = (expiry - dateNow) / (1000 * 60 * 60 * 24);
            const isRelevantTerm = daysToExpiry < 30 && daysToExpiry > 0;

            // NEW: Tradeable range filter — skip markets already resolved (both sides extreme)
            let inTradeableRange = true;
            if (m.outcomePrices) {
                try {
                    const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
                    if (Array.isArray(prices) && prices.length >= 2) {
                        const yesP = parseFloat(prices[0]);
                        const noP = parseFloat(prices[1]);
                        // Market is untradeable if both sides are outside 5-85% range
                        const yesOK = yesP >= 0.05 && yesP <= 0.85;
                        const noOK = noP >= 0.05 && noP <= 0.85;
                        inTradeableRange = yesOK || noOK;
                    }
                } catch { /* keep market if we can't parse prices */ }
            }

            return hasLiquidity && isRelevantTerm && inTradeableRange;
        });

        relevantMarketsCache = filtered;
        lastRelevantScanCalls = tsNow;
        return filtered;
    } catch (e) {
        console.error('Error in getRelevantMarkets:', e);
        return [];
    }
}

export async function checkConnectivity() {
    // 1. Check Gamma
    try {
        const res = await fetch('https://gamma-api.polymarket.com/health', { signal: AbortSignal.timeout(5000) });
        botState.apiStatus.gamma = res.ok ? 'ONLINE' : 'DEGRADED';
    } catch (e) {
        botState.apiStatus.gamma = 'OFFLINE';
    }

    // 2. Check CLOB
    try {
        const res = await fetch('https://clob.polymarket.com/health', { signal: AbortSignal.timeout(5000) });
        botState.apiStatus.clob = res.ok ? 'ONLINE' : 'DEGRADED';
    } catch (e) {
        botState.apiStatus.clob = 'OFFLINE';
    }

    // 3. Check Alpha (Placeholder/Internal)
    botState.apiStatus.alpha = botState.lastPizzaData ? 'ONLINE' : 'OFFLINE';
}

function extractEntities(text) {
    if (!text) return [];
    const entities = new Set();
    const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) || [];
    capitalizedWords.forEach(word => {
        if (!['Will', 'The', 'Is', 'Are', 'Does', 'Has', 'When', 'What', 'Who'].includes(word)) {
            entities.add(word);
        }
    });

    const economicKeywords = ['bitcoin', 'crypto', 'GDP', 'inflation', 'recession', 'fed', 'rates', 'economy'];
    const politicalKeywords = ['election', 'president', 'congress', 'senate', 'vote', 'policy'];
    const geopoliticalKeywords = ['war', 'strike', 'military', 'conflict', 'peace', 'treaty', 'sanctions'];

    const lowerText = text.toLowerCase();
    [...economicKeywords, ...politicalKeywords, ...geopoliticalKeywords].forEach(kw => {
        if (lowerText.includes(kw)) {
            entities.add(kw.charAt(0).toUpperCase() + kw.slice(1));
        }
    });
    return Array.from(entities);
}

function updateKeywordScore(keyword, baseScore = 1.0) {
    if (!botState.keywordScores[keyword]) {
        botState.keywordScores[keyword] = {
            score: baseScore,
            lastSeen: Date.now(),
            frequency: 1
        };
    } else {
        const data = botState.keywordScores[keyword];
        data.frequency += 1;
        data.lastSeen = Date.now();
        data.score = Math.min(10, baseScore * Math.log(data.frequency + 1));
    }
}

function getKeywordRelevance(keyword) {
    const data = botState.keywordScores[keyword];
    if (!data) return 0;
    const daysSinceLastSeen = (Date.now() - data.lastSeen) / (1000 * 60 * 60 * 24);
    const timeDecay = Math.exp(-daysSinceLastSeen / 3);
    return data.score * timeDecay * Math.log(data.frequency + 1);
}

export function categorizeMarket(question) {
    const text = question.toLowerCase();
    const categories = {
        geopolitical: ['pentagon', 'israel', 'iran', 'hezbollah', 'war', 'strike', 'attack', 'military', 'conflict', 'ukraine', 'russia', 'china', 'taiwan'],
        economic: ['bitcoin', 'crypto', 'gdp', 'economy', 'fed', 'rates', 'inflation', 'recession'],
        political: ['trump', 'election', 'president', 'congress', 'senate'],
        tech: ['spacex', 'elon', 'tesla', 'apple', 'nvidia', 'ai', 'gpt', 'tech'],
        sports: ['nba', 'nfl', 'super bowl', 'sports', 'championship', 'playoff']
    };

    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(kw => text.includes(kw))) return category;
    }
    return 'other';
}

function calculateFreshScore(market, ageHours) {
    let score = 50;
    if (ageHours < 6) score += 25;
    else if (ageHours < 12) score += 15;
    else score += 5;

    const pizzaData = botState.lastPizzaData;
    const tension = pizzaData?.tensionScore || 0;
    const T = CONFIG.TENSION || {};
    const category = categorizeMarket(market.question);
    if ((category === 'geopolitical' || category === 'economic') && tension > 0) {
        if (tension >= (T.CRITICAL || 80)) score += (T.FRESH_BONUS_CRITICAL || 30);
        else if (tension >= (T.HIGH || 55)) score += (T.FRESH_BONUS_HIGH || 20);
        else if (tension >= (T.ELEVATED || 30)) score += (T.FRESH_BONUS_ELEVATED || 10);
    }
    if (pizzaData?.tensionTrend === 'RISING' && (category === 'geopolitical' || category === 'economic')) {
        score += 5;
    }

    // Real news match — use structured matching instead of simple keyword scan
    const newsResult = matchMarketToNews(market, botState.newsSentiment);
    if (newsResult?.matched) {
        const N = CONFIG.NEWS || {};
        if (newsResult.sentiment === 'bullish') score += (N.BULLISH_MATCH_BONUS || 15);
        else if (newsResult.sentiment === 'bearish') score += (N.BEARISH_MATCH_BONUS || 15);
        else score += (N.NEUTRAL_MATCH_BONUS || 5);
        // Store match on market for engine to use later
        market._newsMatch = newsResult;
    }

    const vol24h = parseFloat(market.volume24hr || 0);
    if (vol24h > 2000) score += 15;
    else if (vol24h > 500) score += 5;

    const keywords = extractEntities(market.question);
    const relevance = keywords.reduce((sum, kw) => {
        const kwRelevance = getKeywordRelevance(kw);
        return sum + (kwRelevance || 0);
    }, 0);
    score += Math.min(10, relevance * 2);

    return Math.min(100, score);
}

function calculateAlphaScore(market, pizzaData) {
    let score = 0;
    const reasons = [];
    const now = new Date();
    const expiry = new Date(market.endDate);
    const daysToExpiry = (expiry - now) / (1000 * 60 * 60 * 24);
    const category = categorizeMarket(market.question);

    if (daysToExpiry < 5) { score += 25; reasons.push('Expire <5j (+25)'); }
    else if (daysToExpiry < 10) { score += 15; reasons.push('Expire <10j (+15)'); }

    const liquidity = parseFloat(market.liquidityNum || 0);
    const volume24h = parseFloat(market.volume24hr || 0);
    const momentumRatio = volume24h / (liquidity + 1);

    if (momentumRatio > 0.5) { score += 30; reasons.push('Momentum fort (+30)'); }
    else if (momentumRatio > 0.1) { score += 15; reasons.push('Momentum moyen (+15)'); }

    const W = CONFIG.WHALE_TRACKING || {};
    // Match via whale data (real trades) or fallback to old conditionId match
    const whaleMatch = matchWhaleToMarket(market, botState.lastWhaleData) ||
        botState.whaleAlerts?.find(w => w.slug === market.slug || w.id === (market.conditionID || market.conditionId));
    if (whaleMatch) {
        score += (W.WHALE_ALPHA_BONUS || 35);
        reasons.push(`🐳 Whale $${Math.round(whaleMatch.totalVolume || whaleMatch.volume)} (${whaleMatch.consensus || 'N/A'}) (+${W.WHALE_ALPHA_BONUS || 35})`);
        // Extra bonus if multiple whales agree
        if ((whaleMatch.whaleCount || 0) >= 2 && whaleMatch.consensus !== 'MIXED') {
            score += (W.WHALE_CONSENSUS_BONUS || 15);
            reasons.push(`Multi-whale consensus (+${W.WHALE_CONSENSUS_BONUS || 15})`);
        }
        market._whaleMatch = whaleMatch; // Store for engine
    }

    const hasArbitrage = botState.arbitrageOpportunities.some(a => a.id === market.id);
    if (hasArbitrage) { score += 25; reasons.push('Arbitrage (+25)'); }

    if (pizzaData) {
        const tension = pizzaData.tensionScore || 0;
        const T = CONFIG.TENSION || {};

        if (tension >= (T.CRITICAL || 80)) {
            if (category === 'geopolitical') {
                score += (T.GEO_BONUS_CRITICAL || 60);
                reasons.push(`🚨 CRISIS (tension ${tension}) + Géopolitique (+${T.GEO_BONUS_CRITICAL || 60})`);
            } else if (category === 'economic') {
                score += (T.ECO_BONUS_CRITICAL || 40);
                reasons.push(`🚨 CRISIS (tension ${tension}) + Économique (+${T.ECO_BONUS_CRITICAL || 40})`);
            } else if (category === 'sports') {
                score += (T.SPORTS_PENALTY_CRITICAL || -50);
                reasons.push(`Sports pendant crise (${T.SPORTS_PENALTY_CRITICAL || -50})`);
            }
        } else if (tension >= (T.HIGH || 55)) {
            if (category === 'geopolitical') {
                score += (T.GEO_BONUS_HIGH || 40);
                reasons.push(`HIGH tension (${tension}) + Géopolitique (+${T.GEO_BONUS_HIGH || 40})`);
            } else if (category === 'economic') {
                score += (T.ECO_BONUS_HIGH || 25);
                reasons.push(`HIGH tension (${tension}) + Économique (+${T.ECO_BONUS_HIGH || 25})`);
            } else if (category === 'sports') {
                score += (T.SPORTS_PENALTY_HIGH || -30);
                reasons.push(`Sports pendant tension haute (${T.SPORTS_PENALTY_HIGH || -30})`);
            }
        } else if (tension >= (T.ELEVATED || 30)) {
            if (category === 'geopolitical') {
                score += (T.GEO_BONUS_ELEVATED || 15);
                reasons.push(`ELEVATED tension (${tension}) + Géopolitique (+${T.GEO_BONUS_ELEVATED || 15})`);
            } else if (category === 'economic') {
                score += (T.ECO_BONUS_ELEVATED || 10);
                reasons.push(`ELEVATED tension (${tension}) + Économique (+${T.ECO_BONUS_ELEVATED || 10})`);
            }
        }

        // Proportional tension multiplier for geo markets
        if (tension >= (T.ELEVATED || 30) && category === 'geopolitical') {
            const multiplier = 1.0 + (tension / 200);
            score *= multiplier;
            reasons.push(`Tension ${tension} x${multiplier.toFixed(2)}`);
        }

        // Rising tension early detection bonus
        if (pizzaData.tensionTrend === 'RISING' && (category === 'geopolitical' || category === 'economic')) {
            score += (T.RISING_TREND_BONUS || 10);
            reasons.push(`Tension RISING (+${T.RISING_TREND_BONUS || 10})`);
        }
    } else {
        if (category === 'geopolitical' || category === 'economic') {
            score += 20;
            reasons.push('PizzINT Offline: Bonus Catégorie (+20)');
        }
    }

    if (category === 'sports' && (!pizzaData || (pizzaData.tensionScore || 0) < 30)) {
        score -= 20;
        reasons.push('Catégorie Sports (-20)');
    }

    if (category !== 'sports') {
        score += 10;
        reasons.push('Diversification (+10)');
    }

    const finalScore = Math.max(0, Math.min(100, score));

    if (finalScore > 75) {
        stateManager.addSectorEvent(category, 'ANALYSIS', `High Alpha: ${market.question.substring(0, 30)}...`, { score: finalScore.toFixed(0) });
    }

    market._scoreReasons = reasons;
    market._category = category;

    return finalScore;
}


// --- SIGNAL DETECTORS ---

// Track last news refresh to avoid hammering every cycle
let lastNewsRefresh = 0;

export async function fetchNewsSentiment() {
    try {
        // Only refresh news every NEWS.REFRESH_INTERVAL_MS (15 min default)
        const now = Date.now();
        const refreshInterval = CONFIG.NEWS?.REFRESH_INTERVAL_MS || 15 * 60 * 1000;
        if (botState.newsSentiment?.length > 0 && (now - lastNewsRefresh) < refreshInterval) {
            return; // Keep existing news data, skip refresh
        }

        const markets = await getRelevantMarkets(false);
        const sentiments = await fetchRealNewsSentiment(markets);

        if (sentiments.length > 0) {
            botState.newsSentiment = sentiments;
            lastNewsRefresh = now;
            const summary = `[News] Real news updated: ${sentiments.length} topics, ${sentiments.filter(s => s.sentiment === 'bullish').length} bullish / ${sentiments.filter(s => s.sentiment === 'bearish').length} bearish / ${sentiments.filter(s => s.sentiment === 'neutral').length} neutral`;
            try { addLog(summary); } catch { console.log(summary); }
        } else {
            // Fallback: keep old data if fresh fetch returns nothing
            if (!botState.newsSentiment || botState.newsSentiment.length === 0) {
                botState.newsSentiment = [{ title: "No news data available", sentiment: "neutral", source: "System" }];
            }
        }
    } catch (e) {
        console.error("News fetch error:", e.message);
        if (!botState.newsSentiment || botState.newsSentiment.length === 0) {
            botState.newsSentiment = [{ title: "News feed unavailable", sentiment: "neutral", source: "System" }];
        }
    }
}

// Track last whale refresh
let lastWhaleRefresh = 0;

export async function detectWhales(markets = null) {
    try {
        // Only refresh every WHALE_TRACKING.REFRESH_INTERVAL_MS (5 min default)
        const now = Date.now();
        const refreshInterval = CONFIG.WHALE_TRACKING?.REFRESH_INTERVAL_MS || 5 * 60 * 1000;
        if (botState.whaleAlerts?.length > 0 && (now - lastWhaleRefresh) < refreshInterval) {
            return; // Keep existing whale data
        }

        // Fetch real whale trades from Polymarket Data API
        const whaleData = await fetchWhaleTrades();
        botState.lastWhaleData = whaleData; // Store full data for engine use

        // Convert to whaleAlerts format (backwards-compatible with existing code)
        botState.whaleAlerts = whaleData.markets.slice(0, 10).map(wm => ({
            id: wm.conditionId,
            question: wm.title,
            slug: wm.slug,
            volume: wm.totalVolume,
            // New enriched fields
            whaleCount: wm.whaleCount,
            consensus: wm.consensus,
            buyRatio: wm.buyRatio,
            topTrade: wm.topTrade,
            trades: wm.trades,
        }));

        if (whaleData.totalWhaleTrades > 0) {
            lastWhaleRefresh = now;
            const summary = `[Whale] ${whaleData.totalWhaleTrades} whale trades ($${Math.round(whaleData.totalVolume)}) across ${whaleData.markets.length} markets`;
            try { addLog(summary); } catch { console.log(summary); }
        }
    } catch (e) { console.error("Whale Scan Error:", e.message); }
}

export async function scanArbitrage(markets = null) {
    botState.arbitrageOpportunities = [];
    try {
        if (!markets) markets = await getRelevantMarkets(false);
        markets.forEach(m => {
            if (m.outcomePrices) {
                const pYes = parseFloat(m.outcomePrices[0]);
                const pNo = parseFloat(m.outcomePrices[1]);
                const sum = pYes + pNo;
                if (sum < 0.999 && sum > 0.1) {
                    botState.arbitrageOpportunities.push({
                        id: m.id,
                        question: m.question,
                        sum: sum.toFixed(3),
                        profit: ((1 - sum) * 100).toFixed(1),
                        slug: m.slug
                    });
                }
            }
        });
    } catch (e) { console.error("Arb Scan Error:", e.message); }
}

export async function detectWizards(markets = null) {
    botState.wizards = [];
    try {
        if (!markets) markets = await getRelevantMarkets(false);
        markets.forEach(m => {
            if (!m.outcomePrices) return;
            let prices = m.outcomePrices;
            if (typeof prices === 'string') {
                try { prices = JSON.parse(prices); } catch (e) { return; }
            }
            const pYes = parseFloat(prices[0]);
            const pNo = parseFloat(prices[1]);
            const liq = parseFloat(m.liquidityNum || 0);

            // Check YES Wizards
            if (pYes < 0.35 && pYes > 0.01 && liq > 500) {
                const alpha = calculateAlphaScore(m, botState.lastPizzaData);
                if (alpha > 30) {
                    botState.wizards.push({ id: m.id, side: 'YES', slug: m.slug, question: m.question, price: pYes.toFixed(3), alpha: alpha, reason: `YES Alpha ${alpha}%` });
                }
            }
            // Check NO Wizards
            else if (pNo < 0.35 && pNo > 0.01 && liq > 500) {
                const alpha = calculateAlphaScore(m, botState.lastPizzaData);
                if (alpha > 30) {
                    botState.wizards.push({ id: m.id, side: 'NO', slug: m.slug, question: m.question, price: pNo.toFixed(3), alpha: alpha, reason: `NO Alpha ${alpha}%` });
                }
            }
        });
        botState.wizards = botState.wizards.sort((a, b) => b.alpha - a.alpha).slice(0, 5);
        console.log(`🧙 Wizards Detected: ${botState.wizards.length}`);
    } catch (e) { console.error("Wizard Scan Error:", e.message); }
}

export async function detectFreshMarkets() {
    try {
        // Need to fetch fresh markets from Gamma specifically? 
        // getRelevantMarkets filters internally often.
        // Assuming implementation here replicates the one in unified_bot.js which calls fetch directly 
        // OR uses an exported function. 
        // The original code called fetchWithRetry('https://gamma-api.polymarket.com/markets?limit=20&start_date_min=...')
        // Since we don't have that exported, let's assume we can fetch directly here for now or adapt.
        // For simplicity, I'll rely on getRelevantMarkets to find *some* markets, but the original loop
        // was fetching specific fresh endpoint.
        // Let's implement the specific fetch here using global fetch for now.

        const now = new Date();
        // Since we don't have fetchWithRetry exposed yet (it was local), let's use standard fetch
        const response = await fetch('https://gamma-api.polymarket.com/markets?limit=50&active=true&closed=false&order=startDate&ascending=false');
        if (!response.ok) return;
        const markets = await response.json();

        botState.freshMarkets = [];

        for (const market of markets) {
            const createdAt = new Date(market.createdAt || market.startDate || now);
            const ageHours = (now - createdAt) / (1000 * 60 * 60);

            if (ageHours < 24 && ageHours >= 0) {
                const score = calculateFreshScore(market, ageHours);

                if (score > 60) {
                    botState.freshMarkets.push({
                        id: market.id,
                        question: market.question,
                        slug: market.slug,
                        outcomePrices: market.outcomePrices,
                        volume24hr: market.volume24hr,
                        liquidityNum: market.liquidityNum,
                        volumeNum: market.volumeNum,
                        endDate: market.endDate,
                        endDateIso: market.endDateIso,
                        freshScore: score,
                        ageHours: ageHours.toFixed(1)
                    });
                }
            }
        }

        botState.freshMarkets.sort((a, b) => b.freshScore - a.freshScore);
        if (botState.freshMarkets.length > 5) {
            botState.freshMarkets = botState.freshMarkets.slice(0, 5);
        }
        botState.apiStatus.gamma = 'ONLINE';
    } catch (e) {
        console.error('Error detectFreshMarkets:', e.message);
        botState.apiStatus.gamma = 'OFFLINE';
    }
}

export async function updateTopSignal(pizzaData) {
    try {
        const markets = await getRelevantMarkets();
        if (markets.length === 0) return;

        const scoredMarkets = markets.map(m => {
            const score = calculateAlphaScore(m, pizzaData);
            m._alphaScore = score;
            return { ...m, score };
        }).sort((a, b) => b.score - a.score);

        if (scoredMarkets.length > 0) {
            const top = scoredMarkets[0];
            botState.topSignal = {
                id: top.id,
                question: top.question,
                score: top.score,
                reason: top.score > 80 ? "Alpha Matrix: Corrélation de signal maximale" : "Alpha Matrix: Momentum & Sentiment positifs",
                timestamp: new Date().toISOString(),
                slug: top.slug
            };

            stateManager.addSectorEvent(top._category, 'SIGNAL', `Top Signal Detected: ${top.score}/100`, { market: top.question });

            // getEventSlug is needed here?
            // botState.topSignal.eventSlug = ...
            // Simplify for now until getEventSlug is moved.
        }
    } catch (e) {
        console.error('❌ Erreur updateTopSignal:', e.message);
    }
}

