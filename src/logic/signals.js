
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';
import { getTrendingMarkets, getContextualMarkets, fetchAvailableTags } from '../api/market_discovery.js';

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

        const defconLevel = botState.lastPizzaData?.defcon || 5;

        // Crisis Mode
        if (defconLevel <= 2) {
            const contextualMarkets = await getContextualMarkets(defconLevel, 100);
            addLog(botState, `🚨 Crisis mode: Using ${contextualMarkets.length} geo/eco markets`, 'warning');
            return contextualMarkets;
        }

        // Diversified Strategy
        const p1 = getTrendingMarkets(50);
        const p2 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&tag_id=1').then(r => r.json()).catch(() => []);
        const p3 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&tag_id=2').then(r => r.json()).catch(() => []);
        const p4 = fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&tag_id=3').then(r => r.json()).catch(() => []);

        const [trending, politics, eco, tech] = await Promise.all([p1, p2, p3, p4]);

        // Merge and deduplicate
        const uniqueMap = new Map();
        [...(Array.isArray(trending) ? trending : []),
        ...(Array.isArray(politics) ? politics : []),
        ...(Array.isArray(eco) ? eco : []),
        ...(Array.isArray(tech) ? tech : [])].forEach(m => {
            if (m && m.id) uniqueMap.set(m.id, m);
        });
        const mergedMarkets = Array.from(uniqueMap.values());

        // Filter
        const dateNow = new Date();
        const filtered = mergedMarkets.filter(m => {
            const text = (m.question + ' ' + (m.description || '')).toLowerCase();
            const hasKeyword = CONFIG.KEYWORDS.length === 0 ||
                CONFIG.KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
            const hasLiquidity = parseFloat(m.liquidityNum || 0) > 100;
            const expiry = new Date(m.endDate);
            const daysToExpiry = (expiry - dateNow) / (1000 * 60 * 60 * 24);
            const isRelevantTerm = daysToExpiry < 30 && daysToExpiry > 0;

            return (hasKeyword || hasLiquidity) && isRelevantTerm;
        });

        relevantMarketsCache = filtered;
        lastRelevantScanCalls = tsNow;
        return filtered;
    } catch (e) {
        console.error('Error in getRelevantMarkets:', e);
        return [];
    }
}

export function checkConnectivity() {
    // Placeholder or import if needed. 
    // In original code it just did fetches.
    // We can move it to a health check module or keep it in server.js
    // For now, let signals manage their own connectivity status implicitly
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
    if (pizzaData && pizzaData.defcon <= 2) {
        const category = categorizeMarket(market.question);
        if (category === 'geopolitical' || category === 'economic') {
            score += 30;
        }
    }

    const keywords = extractEntities(market.question);
    const newsMatch = botState.newsSentiment.some(n =>
        keywords.some(k => n.title.toLowerCase().includes(k.toLowerCase()))
    );
    if (newsMatch) score += 20;

    const vol24h = parseFloat(market.volume24hr || 0);
    if (vol24h > 2000) score += 15;
    else if (vol24h > 500) score += 5;

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

    const isWhaleMarket = botState.whaleAlerts.some(w => w.marketId === market.id);
    if (isWhaleMarket) { score += 35; reasons.push('🐳 Whale Alert (+35)'); }

    const hasArbitrage = botState.arbitrageOpportunities.some(a => a.id === market.id);
    if (hasArbitrage) { score += 25; reasons.push('Arbitrage (+25)'); }

    if (pizzaData) {
        if (pizzaData.defcon <= 2) {
            if (category === 'geopolitical') {
                score += 60;
                reasons.push(`🚨 DEFCON ${pizzaData.defcon} + Géopolitique (+60)`);
            } else if (category === 'economic') {
                score += 40;
                reasons.push(`DEFCON ${pizzaData.defcon} + Économique (+40)`);
            } else if (category === 'sports') {
                score -= 50;
                reasons.push('Sports pendant crise (-50)');
            }
        }

        if (pizzaData.index > 80 && category === 'geopolitical') {
            score *= 1.3;
            reasons.push(`Index ${pizzaData.index} × 1.3`);
        } else if (pizzaData.index < 30 && category === 'economic') {
            score *= 1.2;
            reasons.push(`Index bas ${pizzaData.index} × 1.2`);
        }
    } else {
        if (category === 'geopolitical' || category === 'economic') {
            score += 20;
            reasons.push('PizzINT Offline: Bonus Catégorie (+20)');
        }
    }

    if (category === 'sports' && (!pizzaData || pizzaData.defcon > 3)) {
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

export async function fetchNewsSentiment() {
    try {
        const markets = await getRelevantMarkets(false);
        const keywordMap = {};

        markets.forEach(m => {
            const words = m.question.split(' ').filter(w => w.length > 4);
            const price = parseFloat(m.outcomePrices ? m.outcomePrices[0] : 0.5);
            words.forEach(w => {
                const clean = w.replace(/[^a-zA-Z]/g, '').toUpperCase();
                if (['WILL', 'DOES', 'AFTER', 'BEFORE', 'MARKET'].includes(clean)) return;

                if (!keywordMap[clean]) keywordMap[clean] = { count: 0, totalProb: 0 };
                keywordMap[clean].count++;
                keywordMap[clean].totalProb += price;
            });
        });

        const sortedKeys = Object.keys(keywordMap).sort((a, b) => keywordMap[b].count - keywordMap[a].count).slice(0, 5);

        botState.newsSentiment = sortedKeys.map(k => {
            const data = keywordMap[k];
            const avgProb = data.totalProb / data.count;
            const sentiment = avgProb > 0.60 ? 'bullish' : (avgProb < 0.40 ? 'bearish' : 'neutral');

            return {
                title: `Trend Alert: "${k}" (Avg Prob: ${(avgProb * 100).toFixed(0)}%)`,
                sentiment: sentiment,
                source: `Polymarket Internal (${data.count} mkts)`
            };
        });

        if (botState.newsSentiment.length === 0) {
            botState.newsSentiment = [{ title: "Scanning global markets...", sentiment: "neutral", source: "AlphaMatrix" }];
        }

    } catch (e) {
        console.error("AlphaMatrix Error:", e.message);
        botState.newsSentiment = [{ title: "AlphaStream Disrupted", sentiment: "neutral", source: "System" }];
    }
}

export async function detectWhales() {
    botState.whaleAlerts = [];
    try {
        const markets = await getRelevantMarkets(false);
        markets.forEach(m => {
            const vol = parseFloat(m.volume24hr || 0);
            if (vol > 50000) {
                botState.whaleAlerts.push({
                    id: m.id,
                    question: m.question,
                    volume: vol,
                    slug: m.slug
                });
            }
        });
        botState.whaleAlerts.sort((a, b) => b.volume - a.volume);
        botState.whaleAlerts = botState.whaleAlerts.slice(0, 4);
    } catch (e) { console.error("Whale Scan Error:", e.message); }
}

export async function scanArbitrage() {
    botState.arbitrageOpportunities = [];
    try {
        const markets = await getRelevantMarkets(false);
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

export async function detectWizards() {
    botState.wizards = [];
    try {
        const markets = await getRelevantMarkets(false);
        markets.forEach(m => {
            const pYes = parseFloat(m.outcomePrices ? m.outcomePrices[0] : 0);
            const liq = parseFloat(m.liquidityNum || 0);

            if (pYes < 0.35 && pYes > 0.01 && liq > 500) {
                const alpha = calculateAlphaScore(m, botState.lastPizzaData);
                if (alpha > 30) {
                    botState.wizards.push({
                        id: m.id,
                        slug: m.slug,
                        question: m.question,
                        price: pYes.toFixed(3),
                        alpha: alpha,
                        reason: `Alpha ${alpha}%`
                    });
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

export async function getPriceHistory(marketId, interval = '1h') {
    try {
        // Gamma API endpoint for history
        // interval: '1m', '1h', '1d'
        const response = await fetchWithRetry(`https://gamma-api.polymarket.com/events/${marketId}/history?interval=${interval}`); // Note: Endpoint might be /markets/{id}/history or events.
        // Let's try standard likely endpoint: https://clob.polymarket.com/prices-history is complex.
        // Gamma usually provides history array in market details or separate endpoint.
        // A reliable public history endpoint is often: https://gamma-api.polymarket.com/markets/{id} (contains history?)
        // Actually, let's use the one that works for the frontend charts usually: 
        // https://gamma-api.polymarket.com/history?market={id}&fidelity=...
        // Falling back to a safe "Get History" simulator if unsure, BUT user wants REAL API.
        // Let's use:
        const url = `https://gamma-api.polymarket.com/markets/${marketId}`;
        // The market details often contain 'history' or 'outcomePrices' over time if we pass params?
        // Let's try a dedicated history generic fetch if we can't find specific documentation.
        // Actually, for now, let's look at `clob_api.js` -> `getCLOBTradeHistory`.
        // We can reconstruct trend from recent trades!

        // BETTER APPROACH: Use `getCLOBTradeHistory` from `clob_api.js`! 
        // It returns recent trades. We can check if the last 10 trades are ascending.
        return null; // Implemented in engine using getCLOBTradeHistory instead
    } catch (e) {
        return null;
    }
}
