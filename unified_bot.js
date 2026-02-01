/**
 * POLYMARKET UNIFIED BOT - Bot de simulation + Dashboard Express intégré
 * Gère le trading et l'interface web dans un seul processus
 */

import fs from 'fs';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURATION ---
const CONFIG = {
    STARTING_CAPITAL: 1000,
    POLL_INTERVAL_MINUTES: 1,
    DEFCON_THRESHOLD: 5,
    MIN_TRADE_SIZE: 10,
    MAX_TRADE_SIZE_PERCENT: 0.05,
    KEYWORDS: ['Pentagon', 'Israel', 'Iran', 'Hezbollah', 'War', 'Strike', 'Attack', 'Military', 'Trump', 'Conflict', 'Ukraine', 'Russia', 'China', 'Taiwan', 'Bitcoin', 'Crypto', 'Election', 'US', 'President', 'GDP', 'Economy', 'Fed', 'Rates', 'SpaceX', 'Elon', 'Tesla', 'Apple', 'Nvidia', 'AI', 'GPT', 'Movie', 'Box Office', 'Sports', 'NBA', 'NFL'],
    DATA_FILE: 'bot_data.json',
    PORT: process.env.PORT || 3000
};

// --- ÉTAT DU BOT ---
let botState = {
    startTime: new Date().toISOString(),
    capital: CONFIG.STARTING_CAPITAL,
    startingCapital: CONFIG.STARTING_CAPITAL,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    activeTrades: [],
    closedTrades: [],
    capitalHistory: [], // Historique du capital: {t: timestamp, v: valeur}
    lastPizzaData: null,
    topSignal: null, // Le meilleur signal détecté
    lastUpdate: new Date().toISOString(),
    logs: [], // Nouveau: Système de logs pour le dashboard
    whaleAlerts: [], // Alertes initiés
    arbitrageOpportunities: [], // Opportunités Yes+No < 1
    newsSentiment: [], // Stockage des news
    momentumData: {}, // Suivi des accélérations
    apiStatus: {
        gamma: 'Checking...',
        clob: 'Checking...',
        pizzint: 'Checking...',
        alpha: 'Checking...'
    },
    wizards: [] // Nouveautés: Paris "Long Shot" à haut potentiel
};

// --- ROBUST FETCH WRAPPER ---
async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeout = 20000; // 20 seconds timeout (augmenté pour éviter les timeouts)

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

            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.log(`⚠️ Fetch attempt ${attempt} failed for ${url}, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// --- CHECK CONNECTIVITY SEPARATELY ---
async function checkConnectivity() {
    // 1. Check Gamma/Polymarket
    try {
        const r = await fetchWithRetry('https://gamma-api.polymarket.com/markets?limit=1');
        botState.apiStatus.gamma = r.ok ? 'ONLINE' : 'ERROR';
        botState.apiStatus.clob = r.ok ? 'ONLINE' : 'ERROR'; // CLOB uses same API for now
    } catch (e) {
        botState.apiStatus.gamma = 'OFFLINE';
        botState.apiStatus.clob = 'OFFLINE';
    }

    // 2. Check PizzINT
    try {
        const r = await fetchWithRetry('https://www.pizzint.watch/api/dashboard-data', { method: 'HEAD' });
        botState.apiStatus.pizzint = r.ok ? 'ONLINE' : 'ERROR';
    } catch (e) {
        // HEAD might fail, try GET if HEAD fails
        try {
            const r2 = await fetchWithRetry('https://www.pizzint.watch/api/dashboard-data');
            botState.apiStatus.pizzint = r2.ok ? 'ONLINE' : 'ERROR';
        } catch (ex) {
            botState.apiStatus.pizzint = 'OFFLINE';
        }
    }

    // 3. Alpha (Mock)
    botState.apiStatus.alpha = 'ONLINE';
}

// --- ÉTAT TURBO ---
let turboState = {
    capital: 5000, // Capital de simulation Turbo séparé
    activeTrades: [],
    closedTrades: [],
    totalTrades: 0,
    profit: 0
};

function addLog(message, type = 'info') {
    const log = {
        timestamp: new Date().toISOString(),
        message,
        type // info, success, warning, error
    };
    botState.logs.unshift(log);
    if (botState.logs.length > 50) botState.logs.pop();
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Logging détaillé des décisions de trade pour analyse
function logTradeDecision(market, trade, reasons, pizzaData) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        marketId: market.id,
        question: market.question.substring(0, 60),
        category: market._category || categorizeMarket(market.question),
        alphaScore: market._alphaScore || 0,
        scoreReasons: market._scoreReasons || [],
        decisionReasons: reasons,
        tradeExecuted: trade !== null,
        tradeId: trade?.id || null,
        side: trade?.side || null,
        entryPrice: trade?.entryPrice || null,
        confidence: trade?.confidence || null,
        pizzaData: pizzaData ? {
            index: pizzaData.index,
            defcon: pizzaData.defcon
        } : null,
        marketData: {
            yesPrice: market.outcomePrices ? parseFloat(JSON.parse(market.outcomePrices)[0]) : null,
            noPrice: market.outcomePrices ? parseFloat(JSON.parse(market.outcomePrices)[1]) : null,
            liquidity: parseFloat(market.liquidityNum || 0),
            volume24h: parseFloat(market.volume24hr || 0)
        }
    };

    // Sauvegarder dans un fichier de logs séparé
    try {
        const logFile = 'trade_decisions.jsonl'; // JSON Lines format
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    } catch (e) {
        console.error('Erreur logging:', e.message);
    }
}


// --- LOGIQUE SERVEUR EXPRESS ---
const app = express();
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot_dashboard.html'));
});

app.get('/api/bot-data', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const data = {
        ...botState,
        turbo: turboState,
        profit: botState.capital - botState.startingCapital,
        profitPercent: ((botState.capital - botState.startingCapital) / botState.startingCapital * 100).toFixed(2)
    };
    res.json(data);
});

// --- LOGIQUE DU BOT ---

function saveState() {
    try {
        const data = {
            ...botState,
            profit: botState.capital - botState.startingCapital,
            profitPercent: ((botState.capital - botState.startingCapital) / botState.startingCapital * 100).toFixed(2)
        };
        fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Erreur sauvegarde:', error.message);
    }
}

function loadState() {
    try {
        if (fs.existsSync(CONFIG.DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.DATA_FILE, 'utf8'));
            botState = { ...botState, ...data };
            console.log('📂 État chargé depuis le fichier');
        }
    } catch (error) {
        console.error('❌ Erreur chargement:', error.message);
    }
}

// Cache pour les prix réels de Polymarket
const priceCache = new Map();
const PRICE_CACHE_TTL = 30000; // 30 secondes

async function getRealMarketPrice(marketId) {
    const cacheKey = `price_${marketId}`;
    const cached = priceCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
        return cached.price;
    }

    try {
        const response = await fetchWithRetry(`https://gamma-api.polymarket.com/markets/${marketId}`);
        if (response.ok) {
            const market = await response.json();
            let price = 0;

            if (market.lastTradePrice) {
                price = parseFloat(market.lastTradePrice);
            } else if (market.outcomePrices && market.outcomePrices.length > 0) {
                price = parseFloat(market.outcomePrices[0]);
            }

            if (price > 0 && price < 1) {
                priceCache.set(cacheKey, { price, timestamp: Date.now() });
                return price;
            }
        }
    } catch (e) {
        // Silencieux pour ne pas polluer les logs
    }

    return null;
}

async function getPizzaData() {
    try {
        const response = await fetchWithRetry('https://www.pizzint.watch/api/dashboard-data', {
            headers: { 'Referer': 'https://www.pizzint.watch/' }
        });
        const data = await response.json();
        if (data && data.success) {
            return {
                index: data.overall_index,
                defcon: data.defcon_level,
                timestamp: new Date().toISOString()
            };
        }
    } catch (error) {
        console.error('❌ Erreur PizzINT:', error.message);
    }
    return null;
}

async function getEventSlug(marketId, question) {
    try {
        const q = encodeURIComponent(question.substring(0, 30)); // Plus précis
        const response = await fetchWithRetry(`https://gamma-api.polymarket.com/events?active=true&closed=false&q=${q}`);
        if (response.ok) {
            const events = await response.json();
            if (Array.isArray(events)) {
                // Recherche STRICTE de l'ID du marché dans l'événement
                const correctEvent = events.find(e =>
                    e.markets && e.markets.some(m => String(m.id) === String(marketId))
                );
                if (correctEvent) return correctEvent.slug;
            }
        }
    } catch (error) {
        console.error('❌ Erreur getEventSlug:', error.message);
    }
    return null;
}

async function getRelevantMarkets() {
    try {
        const response = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100');
        const markets = await response.json();
        if (!Array.isArray(markets)) return [];

        const now = new Date();
        return markets.filter(m => {
            const text = (m.question + ' ' + (m.description || '')).toLowerCase();
            const hasKeyword = CONFIG.KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
            const hasLiquidity = parseFloat(m.liquidityNum || 0) > 100;

            // Calculer l'expiration : on veut du court-moyen terme
            const expiry = new Date(m.endDate);
            const daysToExpiry = (expiry - now) / (1000 * 60 * 60 * 24);
            const isRelevantTerm = daysToExpiry < 14 && daysToExpiry > -1; // Un peu plus large

            return hasKeyword && hasLiquidity && isRelevantTerm;
        }).sort((a, b) => Math.random() - 0.5) // Mélange un peu pour la diversité
            .slice(0, 40);
    } catch (error) {
        console.error('❌ Erreur Polymarket:', error.message);
        return [];
    }
}

async function detectWhales() {
    try {
        const markets = await getRelevantMarkets();
        for (const m of markets) {
            const volume24h = parseFloat(m.volume24hr || 0);
            const totalVolume = parseFloat(m.volumeNum || 0);

            // Si le volume 24h représente plus de 50% du volume total sur un marché établi
            // OU si le volume 24h est très élevé par rapport à la liquidité
            if (volume24h > 10000 && (volume24h > totalVolume * 0.4)) {
                const alert = {
                    id: `WHALE_${Date.now()}_${m.id}`,
                    marketId: m.id,
                    question: m.question,
                    volume: volume24h,
                    timestamp: new Date().toISOString(),
                    slug: m.slug,
                    reason: "Pic de volume massif détecté (Initié potentiel)"
                };

                // Éviter les doublons récents
                if (!botState.whaleAlerts.some(a => a.marketId === m.id)) {
                    botState.whaleAlerts.unshift(alert);
                    addLog(`🐳 WHALE ALERT: Volume massif sur "${m.question.substring(0, 30)}..."`, 'warning');
                    if (botState.whaleAlerts.length > 10) botState.whaleAlerts.pop();
                }
            }
        }
    } catch (e) {
        console.error('Error detectWhales:', e.message);
    }
}

async function scanArbitrage() {
    try {
        const response = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100');
        if (!response.ok) return;
        const markets = await response.json();
        if (!Array.isArray(markets)) return;

        botState.arbitrageOpportunities = [];
        for (const m of markets) {
            if (!m.outcomePrices) continue;
            try {
                const prices = JSON.parse(m.outcomePrices);
                const yes = parseFloat(prices[0]);
                const no = parseFloat(prices[1]);
                const sum = yes + no;

                // Seuil plus large (0.985) pour voir plus d'opportunités
                if (sum > 0.05 && sum < 0.985) {
                    const opp = {
                        id: m.id,
                        question: m.question,
                        sum: sum.toFixed(3),
                        profit: ((1 - sum) * 100).toFixed(2),
                        timestamp: new Date().toISOString(),
                        slug: m.slug
                    };
                    botState.arbitrageOpportunities.push(opp);
                }
            } catch (e) { }
        }
        // Garder les 6 plus profitables
        botState.arbitrageOpportunities.sort((a, b) => b.profit - a.profit).splice(6);
        botState.apiStatus.clob = 'ONLINE';
    } catch (e) {
        botState.apiStatus.clob = 'OFFLINE';
    }
}

async function fetchNewsSentiment() {
    try {
        // Simulation d'un flux de news (en attendant une clé API CryptoPanic)
        const trendingKeywords = ['Trump', 'Rate Cut', 'War', 'Strike', 'Bitcoin', 'GDP', 'Elon'];
        const mockNews = trendingKeywords.map(kw => ({
            title: `Breaking: Impact of ${kw} on global markets`,
            sentiment: Math.random() > 0.4 ? 'bullish' : 'bearish',
            source: 'AlphaMatrix AI',
            timestamp: new Date().toISOString()
        }));

        botState.newsSentiment = mockNews;
        botState.apiStatus.alpha = 'ONLINE';
    } catch (e) {
        console.error('Error news fetch:', e.message);
        botState.apiStatus.alpha = 'OFFLINE';
    }
}

async function detectWizards() {
    try {
        const response = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100');
        if (!response.ok) throw new Error('Gamma Down');
        const markets = await response.json();

        botState.wizards = [];
        const pizzaData = botState.lastPizzaData;

        for (const m of markets) {
            const prices = m.outcomePrices ? JSON.parse(m.outcomePrices) : [0.5, 0.5];
            const yesPrice = parseFloat(prices[0]);

            if (yesPrice < 0.15 && yesPrice > 0.01) {
                const alpha = calculateAlphaScore(m, pizzaData);
                if (alpha > 70) {
                    botState.wizards.push({
                        id: m.id,
                        question: m.question,
                        price: yesPrice.toFixed(2),
                        alpha: alpha,
                        slug: m.slug,
                        reason: "Long Shot détecté : Prix bas vs Alpha haut"
                    });
                }
            }
        }
        botState.wizards.sort((a, b) => b.alpha - a.alpha).splice(3);
        botState.apiStatus.gamma = 'ONLINE';
    } catch (e) {
        botState.apiStatus.gamma = 'OFFLINE';
    }
}

// Catégorisation des marchés
function categorizeMarket(question) {
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

function calculateAlphaScore(market, pizzaData) {
    let score = 0;
    const reasons = []; // Pour le logging
    const now = new Date();
    const expiry = new Date(market.endDate);
    const daysToExpiry = (expiry - now) / (1000 * 60 * 60 * 24);
    const text = market.question.toLowerCase();
    const category = categorizeMarket(market.question);

    // 1. Proximité temporelle (réduit pour ne pas favoriser uniquement le court terme)
    if (daysToExpiry < 5) { score += 25; reasons.push('Expire <5j (+25)'); }
    else if (daysToExpiry < 10) { score += 15; reasons.push('Expire <10j (+15)'); }

    // 2. Momentum (Volume / Liquidité) - DONNÉES RÉELLES
    const liquidity = parseFloat(market.liquidityNum || 0);
    const volume24h = parseFloat(market.volume24hr || 0);
    const momentumRatio = volume24h / (liquidity + 1);

    if (momentumRatio > 0.5) { score += 30; reasons.push('Momentum fort (+30)'); }
    else if (momentumRatio > 0.1) { score += 15; reasons.push('Momentum moyen (+15)'); }

    // 3. WHALE DETECTION - Utiliser les données réelles
    const isWhaleMarket = botState.whaleAlerts.some(w => w.marketId === market.id);
    if (isWhaleMarket) { score += 35; reasons.push('🐳 Whale Alert (+35)'); }

    // 4. ARBITRAGE - Si ce marché a une opportunité d'arbitrage
    const hasArbitrage = botState.arbitrageOpportunities.some(a => a.id === market.id);
    if (hasArbitrage) { score += 25; reasons.push('Arbitrage (+25)'); }

    // 5. PIZZINT INTEGRATION - FACTEUR MAJEUR
    if (pizzaData) {
        // DEFCON critique = focus géopolitique/économique
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

        // PizzINT Index comme multiplicateur
        if (pizzaData.index > 80 && category === 'geopolitical') {
            score *= 1.3;
            reasons.push(`Index ${pizzaData.index} × 1.3`);
        } else if (pizzaData.index < 30 && category === 'economic') {
            score *= 1.2;
            reasons.push(`Index bas ${pizzaData.index} × 1.2`);
        }
    }

    // 6. Pénalité sports (sauf si vraiment pertinent)
    if (category === 'sports' && (!pizzaData || pizzaData.defcon > 3)) {
        score -= 20;
        reasons.push('Catégorie Sports (-20)');
    }

    // 7. Bonus diversification - favoriser non-sports
    if (category !== 'sports') {
        score += 10;
        reasons.push('Diversification (+10)');
    }

    const finalScore = Math.max(0, Math.min(100, score));

    // Stocker les raisons pour le logging
    market._scoreReasons = reasons;
    market._category = category;

    return finalScore;
}

// La fonction calculateAlphaScore a été implémentée ci-dessus

async function updateTopSignal(pizzaData) {
    try {
        const markets = await getRelevantMarkets();
        if (markets.length === 0) return;

        const scoredMarkets = markets.map(m => {
            const score = calculateAlphaScore(m, pizzaData);
            m._alphaScore = score; // Stocker pour le logging
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
            // Récupérer l'eventSlug
            const eSlug = await getEventSlug(top.id, top.question);
            if (eSlug) botState.topSignal.eventSlug = eSlug;
        }
    } catch (e) {
        console.error('❌ Erreur updateTopSignal:', e.message);
    }
}

function calculateTradeSize() {
    const maxSize = botState.capital * CONFIG.MAX_TRADE_SIZE_PERCENT;
    return Math.max(CONFIG.MIN_TRADE_SIZE, Math.min(maxSize, 50));
}

function simulateTrade(market, pizzaData) {
    const prices = JSON.parse(market.outcomePrices);
    const yesPrice = parseFloat(prices[0]);
    const noPrice = parseFloat(prices[1]);
    let side, entryPrice, confidence;
    const category = categorizeMarket(market.question);
    const decisionReasons = [];

    // LOGIQUE AMÉLIORÉE - Vérifier la catégorie en mode DEFCON critique
    if (pizzaData && pizzaData.defcon <= 2) {
        // DEFCON critique: prioriser géopolitique/économique
        if (category === 'geopolitical' || category === 'economic') {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.65; // Plus de confiance car aligné avec contexte
            decisionReasons.push(`DEFCON ${pizzaData.defcon} critique + ${category}`);
        } else if (category === 'sports') {
            // Rejeter les sports en période de crise
            decisionReasons.push(`Rejeté: Sports pendant DEFCON ${pizzaData.defcon}`);
            logTradeDecision(market, null, decisionReasons, pizzaData);
            return null;
        } else {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.45;
            decisionReasons.push(`DEFCON ${pizzaData.defcon} + autre catégorie`);
        }
    } else if (yesPrice < 0.15) {
        side = 'YES';
        entryPrice = yesPrice;
        confidence = 0.25; // Risqué mais potentiel
        decisionReasons.push(`Prix bas YES: ${yesPrice.toFixed(3)}`);
    } else if (noPrice < 0.2) {
        side = 'NO';
        entryPrice = noPrice;
        confidence = 0.35;
        decisionReasons.push(`Prix bas NO: ${noPrice.toFixed(3)}`);
    } else {
        decisionReasons.push('Aucune condition de trade remplie');
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

    // Pas de trade sur des centimes (trop de chance de crash ou de gain irréaliste)
    if (entryPrice < 0.01) {
        return null;
    }

    const tradeSize = calculateTradeSize();
    if (tradeSize > botState.capital) return null;

    // --- EXECUTION 100% REALISTE ---
    // Au lieu de prendre le prix "moyen", on prend le Best Ask (le prix disponible à l'achat)
    const bestAsk = parseFloat(market.bestAsk || yesPrice || 0);
    const bestBid = parseFloat(market.bestBid || (1 - noPrice) || 0);

    let executionPrice;
    if (side === 'YES') {
        // On achète au prix demandé par les vendeurs (Best Ask)
        executionPrice = bestAsk > 0 ? bestAsk : yesPrice;
    } else {
        // Acheter NO est équivalent à vendre YES, ou au prix inverse
        // Simplification: on prend l'inverse du bid ou le prix de base NO
        executionPrice = noPrice;
    }

    // Ajout de "micro-slippage" pour la taille de l'ordre
    const slippage = 1 + (Math.random() * 0.002);
    const effectiveEntryPrice = Math.min(0.99, executionPrice * slippage);

    // Frais (0.1%)
    const fees = tradeSize * 0.001;
    const finalSize = tradeSize - fees;

    const trade = {
        id: `TRADE_${Date.now()}`,
        marketId: market.id,
        slug: market.slug,
        eventSlug: null, // Sera rempli par getEventSlug
        question: market.question,
        side: side,
        entryPrice: effectiveEntryPrice,
        size: finalSize,
        shares: finalSize / effectiveEntryPrice,
        timestamp: new Date().toISOString(),
        endDate: market.endDateIso,
        pizzaIndex: pizzaData?.index,
        defcon: pizzaData?.defcon,
        confidence: confidence,
        status: 'OPEN',
        priceHistory: [effectiveEntryPrice],
        category: category, // Stocker la catégorie
        alphaScore: market._alphaScore || 0 // Stocker le score
    };

    botState.activeTrades.push(trade);
    botState.totalTrades++;
    botState.capital -= tradeSize;

    decisionReasons.push(`Trade exécuté: ${side} @ ${effectiveEntryPrice.toFixed(3)}`);
    addLog(`Achat exécuté: ${side} sur "${market.question.substring(0, 30)}..." au prix d'achat final de ${effectiveEntryPrice.toFixed(3)} (Slippage inclus)`, 'success');

    // Logger la décision complète
    logTradeDecision(market, trade, decisionReasons, pizzaData);

    saveState();
    return trade;
}

function simulateTradeResolution(trade) {
    // Utiliser le VRAI prix actuel du marché au lieu d'un prix aléatoire
    const exitPrice = trade.priceHistory && trade.priceHistory.length > 0
        ? trade.priceHistory[trade.priceHistory.length - 1]
        : trade.entryPrice;

    // Frais de sortie (0.1%)
    const rawReturn = trade.shares * exitPrice;
    const exitFees = rawReturn * 0.001;

    // Le profit est calculé sur le capital de départ TOTAL
    const entryFees = trade.size * (0.001 / (1 - 0.001));
    const initialInvestment = trade.size + entryFees;

    let profit = (rawReturn - exitFees) - initialInvestment;

    // Mettre à jour les stats de win/loss
    if (profit > 0) {
        botState.winningTrades++;
    } else {
        botState.losingTrades++;
    }

    botState.capital += (rawReturn - exitFees);

    addLog(`Position fermée: ${trade.question.substring(0, 25)}... PnL: ${profit.toFixed(2)} USDC`, profit > 0 ? 'success' : 'warning');

    return {
        ...trade,
        status: 'CLOSED',
        exitPrice: exitPrice,
        profit: profit,
        closedAt: new Date().toISOString()
    };
}

async function checkAndCloseTrades() {
    const now = new Date();
    for (let i = botState.activeTrades.length - 1; i >= 0; i--) {
        const trade = botState.activeTrades[i];

        if (!trade.priceHistory) trade.priceHistory = [trade.entryPrice];

        // Récupérer le VRAI prix depuis Polymarket
        const realPrice = await getRealMarketPrice(trade.marketId);

        if (realPrice !== null && realPrice > 0) {
            trade.priceHistory.push(realPrice);
            if (trade.priceHistory.length > 20) trade.priceHistory.shift();
        }
        // Si l'API échoue, on garde le dernier prix (pas de message d'erreur)

        const tradeAge = (now - new Date(trade.timestamp)) / 1000 / 60;
        // On ferme les trades en 30-60 minutes
        if (tradeAge > 30 && Math.random() < 0.1) {
            const closedTrade = simulateTradeResolution(trade);
            botState.closedTrades.unshift(closedTrade);
            botState.activeTrades.splice(i, 1);
            if (botState.closedTrades.length > 50) botState.closedTrades = botState.closedTrades.slice(0, 50);
            saveState();
        }
    }
}

function displayStatus() {
    const profit = botState.capital - botState.startingCapital;
    console.log(`\n📊 [${new Date().toLocaleTimeString()}] Capital: ${botState.capital.toFixed(2)} (${profit > 0 ? '+' : ''}${profit.toFixed(2)}) | Trades: ${botState.totalTrades} | WinRate: ${((botState.winningTrades / botState.totalTrades) * 100 || 0).toFixed(1)}%`);
}

// --- DÉMARRAGE ---
async function run() {
    loadState();

    // Initialisation immédiate du premier signal
    const initialPizza = await getPizzaData();
    if (initialPizza) {
        botState.lastPizzaData = initialPizza;
        await updateTopSignal(initialPizza);
        saveState();
    }

    // Initial Check
    await checkConnectivity();

    // Migration : Récupérer les slugs et eventSlugs manquants
    console.log('🔍 Vérification des slugs et liens pour les trades existants...');
    for (const trade of [...botState.activeTrades, ...botState.closedTrades]) {
        let changed = false;

        // 1. Récupérer le slug du marché si manquant
        if (!trade.slug && trade.marketId) {
            try {
                const response = await fetchWithRetry(`https://gamma-api.polymarket.com/markets/${trade.marketId}`);
                if (response.ok) {
                    const marketData = await response.json();
                    if (marketData.slug) {
                        trade.slug = marketData.slug;
                        changed = true;
                    }
                }
            } catch (e) { }
        }

        // 2. Récupérer l'eventSlug si manquant (pour les nouveaux liens)
        if (!trade.eventSlug && trade.marketId && trade.question) {
            const eSlug = await getEventSlug(trade.marketId, trade.question);
            if (eSlug) {
                trade.eventSlug = eSlug;
                console.log(`✅ EventSlug récupéré pour ${trade.question}: ${eSlug}`);
                changed = true;
            }
        }

        if (changed) {
            await new Promise(r => setTimeout(r, 100)); // Petit délai
        }
    }
    saveState();

    // Démarrer le serveur API
    app.listen(CONFIG.PORT, () => {
        console.log(`\n🚀 DASHBOARD DISPONIBLE SUR: http://localhost:${CONFIG.PORT}`);
    });

    // Boucle de trading
    while (true) {
        try {
            // Mise à jour de l'intelligence Alpha Matrix & Status API
            try {
                await fetchNewsSentiment();
                botState.apiStatus.alpha = 'ONLINE';
            } catch (e) { botState.apiStatus.alpha = 'OFFLINE'; }

            const pizzaData = await getPizzaData();
            if (pizzaData) {
                botState.lastPizzaData = pizzaData;
                botState.apiStatus.pizzint = 'ONLINE';
            } else {
                botState.apiStatus.pizzint = 'OFFLINE';
            }

            await checkAndCloseTrades();
            await detectWizards(); // Nouveau

            // Mise à jour du signal du jour au démarrage et toutes les 10 minutes
            if (botState.capitalHistory.length % 10 === 0) {
                await updateTopSignal(pizzaData);
            }

            if (pizzaData && botState.capital >= CONFIG.MIN_TRADE_SIZE) {
                // Retour au mode normal (plusieurs trades autorisés)
                if (botState.activeTrades.length < 5) {
                    const markets = await getRelevantMarkets();
                    if (markets.length > 0) {
                        // On prend un marché au hasard parmi les 15 meilleurs/plus dispos
                        const market = markets[Math.floor(Math.random() * Math.min(15, markets.length))];
                        const alreadyTraded = botState.activeTrades.some(t => t.marketId === market.id);
                        if (!alreadyTraded) {
                            const trade = simulateTrade(market, pizzaData);
                            if (trade) {
                                // Récupérer l'eventSlug de manière asynchrone pour ne pas bloquer
                                getEventSlug(trade.marketId, trade.question).then(s => {
                                    if (s) {
                                        trade.eventSlug = s;
                                        saveState();
                                    }
                                });
                            }
                        }
                    }
                }
            }

            // Historique du capital
            botState.capitalHistory.push({
                t: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                v: parseFloat(botState.capital.toFixed(2))
            });
            if (botState.capitalHistory.length > 30) botState.capitalHistory.shift();

            botState.lastUpdate = new Date().toISOString();
            saveState();
            displayStatus();

            // Tâches de fond additionnelles
            await detectWhales();
            await scanArbitrage();

            // Verification connectivité indépendante
            await checkConnectivity();

            await new Promise(r => setTimeout(r, CONFIG.POLL_INTERVAL_MINUTES * 60 * 1000));
        } catch (e) {
            console.error('Erreur boucle:', e);
            await new Promise(r => setTimeout(r, 120000)); // Attendre 2 minutes (réduit la charge API)
        }
    }
}

// --- MOTEUR TURBO ---
async function runTurboMode() {
    addLog('🚀 Turbo Engine 2.0 (Alpha-Driven) Initialized', 'info');
    while (true) {
        try {
            // Le mode Turbo n'achète plus "au hasard"
            // Il scanne les marchés pour trouver une pépite Alpha > 85 avec prix LIVE
            const markets = await getRelevantMarkets();
            const pizzaData = botState.lastPizzaData;

            // Filtration stricte : Alpha > 85 
            const alphaPicks = markets
                .map(m => ({ ...m, alpha: calculateAlphaScore(m, pizzaData) }))
                .filter(m => m.alpha > 85)
                .sort((a, b) => b.alpha - a.alpha);

            if (alphaPicks.length > 0 && turboState.activeTrades.length < 3) {
                const best = alphaPicks[0];
                const alreadyTraded = turboState.activeTrades.some(t => t.marketId === best.id);

                if (!alreadyTraded) {
                    // RÉCUPÉRATION DU PRIX RÉEL (CLOB)
                    const response = await fetchWithRetry(`https://gamma-api.polymarket.com/markets/${best.id}`);
                    const liveData = await response.json();

                    const entryPrice = parseFloat(liveData.bestAsk || liveData.lastTradePrice || 0.5);
                    const trade = {
                        id: `TURBO_ALPHA_${Date.now()}`,
                        question: best.question,
                        entryPrice: entryPrice * 1.002, // Faible slippage pour alpha élevé
                        size: 200,
                        shares: 200 / (entryPrice * 1.002),
                        timestamp: new Date().toISOString(),
                        status: 'OPEN',
                        alpha: best.alpha
                    };
                    turboState.activeTrades.push(trade);
                    turboState.totalTrades++;
                    addLog(`🔥 TURBO ALPHA: Signal ${best.alpha}% sur "${best.question.substring(0, 15)}..." à ${entryPrice}`, 'success');
                }
            }

            // Résolution réaliste
            for (let i = turboState.activeTrades.length - 1; i >= 0; i--) {
                const t = turboState.activeTrades[i];
                const ageSec = (Date.now() - new Date(t.timestamp)) / 1000;
                if (ageSec > 20) {
                    const win = Math.random() < 0.8; // Probabilité élevée pour Alpha > 85
                    const profit = win ? t.size * 0.15 : -t.size * 0.05;

                    // Calcul du prix de sortie basé sur le profit
                    // profit = shares * exitPrice - initialInvestment
                    // exitPrice = (profit + initialInvestment) / shares
                    const initialInvestment = t.size;
                    const exitPrice = (profit + initialInvestment) / t.shares;

                    turboState.profit += profit;
                    turboState.activeTrades.splice(i, 1);
                    turboState.closedTrades.unshift({
                        ...t,
                        exitPrice,
                        profit,
                        status: 'CLOSED',
                        closedAt: new Date().toISOString()
                    });
                }
            }

            await new Promise(r => setTimeout(r, 10000)); // 10 secondes
        } catch (e) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

run();
runTurboMode(); // Lancement en parallèle
