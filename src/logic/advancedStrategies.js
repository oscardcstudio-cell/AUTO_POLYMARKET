
/**
 * advancedStrategies.js
 * 7 advanced strategies for long-term bot excellence:
 * 1. Market Memory — track price history per market to detect patterns
 * 2. Cross-Market Intelligence — detect correlated markets
 * 3. Smart Entry Timing — wait for dips instead of market-buying
 * 4. DCA — build positions in multiple entries
 * 5. Event-Driven Trading — external news catalysts
 * 6. Anti-Fragility — structured drawdown recovery
 * 7. Calendar Awareness — adapt to day/hour patterns
 */

import { botState, stateManager } from '../state.js';
import { CONFIG } from '../config.js';
import { categorizeMarket } from './signals.js';
import { getCLOBTradeHistory, analyzeSpread, getCLOBOrderBook } from '../api/clob_api.js';
import { addLog } from '../utils.js';

// ============================================================
// 1. MARKET MEMORY — Remember price snapshots for each market
// ============================================================

// In-memory store: { marketId: { prices: [{t, p}], volumes: [{t, v}] } }
const marketMemory = {};
const MEMORY_MAX_ENTRIES = 200; // ~3h at 1min intervals

/**
 * Record a price snapshot for a market
 */
export function recordMarketSnapshot(market) {
    if (!market?.id || !market.outcomePrices) return;

    const yesPrice = parseFloat(
        typeof market.outcomePrices === 'string'
            ? JSON.parse(market.outcomePrices)[0]
            : market.outcomePrices[0]
    );
    if (isNaN(yesPrice)) return;

    if (!marketMemory[market.id]) {
        marketMemory[market.id] = { prices: [], volumes: [] };
    }

    const mem = marketMemory[market.id];
    const now = Date.now();

    mem.prices.push({ t: now, p: yesPrice });
    mem.volumes.push({ t: now, v: parseFloat(market.volume24hr || 0) });

    // Trim old entries
    if (mem.prices.length > MEMORY_MAX_ENTRIES) mem.prices.shift();
    if (mem.volumes.length > MEMORY_MAX_ENTRIES) mem.volumes.shift();
}

/**
 * Bulk record all markets from a scan
 */
export function recordMarketBatch(markets) {
    if (!Array.isArray(markets)) return;
    for (const m of markets) {
        recordMarketSnapshot(m);
    }
}

/**
 * Detect price pattern: is this market in a range (bouncing between support/resistance)?
 * Returns: { isRange: bool, support: num, resistance: num, currentPosition: 'near_support'|'near_resistance'|'middle' }
 */
export function detectPriceRange(marketId) {
    const mem = marketMemory[marketId];
    if (!mem || mem.prices.length < 20) return null;

    const prices = mem.prices.map(p => p.p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;

    // Need at least 3% range to be meaningful
    if (range < 0.03) return null;

    const current = prices[prices.length - 1];
    const rangePercent = range / ((min + max) / 2);

    // Count reversals (price crosses midpoint)
    const mid = (min + max) / 2;
    let crossings = 0;
    for (let i = 1; i < prices.length; i++) {
        if ((prices[i - 1] < mid && prices[i] > mid) || (prices[i - 1] > mid && prices[i] < mid)) {
            crossings++;
        }
    }

    // Range-bound = at least 3 crossings in our sample
    const isRange = crossings >= 3 && rangePercent < 0.30;

    let currentPosition = 'middle';
    const posInRange = (current - min) / range;
    if (posInRange < 0.25) currentPosition = 'near_support';
    else if (posInRange > 0.75) currentPosition = 'near_resistance';

    return { isRange, support: min, resistance: max, currentPosition, crossings, rangePercent };
}

/**
 * Detect momentum: is price accelerating in one direction?
 * Returns: { momentum: 'accelerating_up'|'accelerating_down'|'decelerating'|'flat', strength: 0-1 }
 */
export function detectMomentum(marketId) {
    const mem = marketMemory[marketId];
    if (!mem || mem.prices.length < 10) return null;

    const prices = mem.prices.slice(-20).map(p => p.p);

    // Compare first half avg vs second half avg
    const halfLen = Math.floor(prices.length / 2);
    const firstHalf = prices.slice(0, halfLen);
    const secondHalf = prices.slice(halfLen);

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const change = (avgSecond - avgFirst) / avgFirst;

    // Check if acceleration is increasing (second derivative)
    const recentChange = prices.length >= 5
        ? (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5]
        : 0;

    const sameDirection = (change > 0 && recentChange > 0) || (change < 0 && recentChange < 0);
    const accelerating = sameDirection && Math.abs(recentChange) > Math.abs(change) * 0.5;

    let momentum = 'flat';
    if (accelerating && change > 0.01) momentum = 'accelerating_up';
    else if (accelerating && change < -0.01) momentum = 'accelerating_down';
    else if (!sameDirection && Math.abs(change) > 0.01) momentum = 'decelerating';

    return { momentum, strength: Math.min(Math.abs(change) * 10, 1.0) };
}

/**
 * Get memory-based conviction bonus for a market
 */
export function getMemorySignal(marketId) {
    let bonus = 0;
    const signals = [];

    const range = detectPriceRange(marketId);
    if (range && range.isRange) {
        if (range.currentPosition === 'near_support') {
            bonus += 15;
            signals.push(`Memory: near support ${range.support.toFixed(3)} (+15)`);
        } else if (range.currentPosition === 'near_resistance') {
            bonus -= 5; // Slightly discourage buying near resistance
            signals.push(`Memory: near resistance ${range.resistance.toFixed(3)} (-5)`);
        }
    }

    const mom = detectMomentum(marketId);
    if (mom) {
        if (mom.momentum === 'accelerating_up' && mom.strength > 0.3) {
            bonus += 10;
            signals.push(`Memory: accelerating up (${(mom.strength * 100).toFixed(0)}%) (+10)`);
        } else if (mom.momentum === 'accelerating_down' && mom.strength > 0.3) {
            bonus += 5; // Could be good for NO trades
            signals.push(`Memory: accelerating down (${(mom.strength * 100).toFixed(0)}%) (+5)`);
        }
    }

    return { bonus, signals };
}


// ============================================================
// 2. CROSS-MARKET INTELLIGENCE — Detect correlated markets
// ============================================================

/**
 * Build a correlation map from active markets.
 * Markets sharing keywords or categories that moved together = correlated.
 * Returns: Map of marketId -> [{ relatedId, correlation, keyword }]
 */
export function buildCorrelationMap(markets) {
    if (!Array.isArray(markets) || markets.length < 5) return new Map();

    const correlations = new Map();

    // Extract significant keywords per market (4+ chars, not generic)
    const stopWords = new Set(['will', 'does', 'have', 'been', 'what', 'when', 'they', 'this', 'that', 'from', 'with', 'more', 'than', 'before', 'after', 'above', 'below']);

    const marketKeywords = markets.map(m => {
        const words = (m.question || '').toLowerCase().split(/\s+/)
            .filter(w => w.length >= 4 && !stopWords.has(w));
        return { id: m.id, keywords: new Set(words), category: categorizeMarket(m.question), price: parseFloat(m.outcomePrices?.[0] || '0.5') };
    });

    // Find markets sharing keywords
    for (let i = 0; i < marketKeywords.length; i++) {
        const related = [];
        for (let j = 0; j < marketKeywords.length; j++) {
            if (i === j) continue;

            // Find shared keywords
            const shared = [];
            for (const kw of marketKeywords[i].keywords) {
                if (marketKeywords[j].keywords.has(kw)) shared.push(kw);
            }

            // At least 2 shared keywords or same category + 1 keyword
            const sameCategory = marketKeywords[i].category === marketKeywords[j].category;
            if (shared.length >= 2 || (sameCategory && shared.length >= 1)) {
                related.push({
                    relatedId: marketKeywords[j].id,
                    sharedKeywords: shared,
                    sameCategory,
                    relatedPrice: marketKeywords[j].price
                });
            }
        }
        if (related.length > 0) {
            correlations.set(marketKeywords[i].id, related);
        }
    }

    return correlations;
}

/**
 * Check if a correlated market has already moved but this one hasn't yet
 * Returns conviction bonus if we detect a lagging opportunity
 */
export function getCrossMarketSignal(marketId, correlationMap) {
    if (!correlationMap || !correlationMap.has(marketId)) return { bonus: 0, signals: [] };

    const related = correlationMap.get(marketId);
    let bonus = 0;
    const signals = [];

    for (const rel of related) {
        // Check if the related market has strong momentum that this one doesn't
        const relMom = detectMomentum(rel.relatedId);
        const thisMom = detectMomentum(marketId);

        if (relMom && relMom.momentum === 'accelerating_up' && relMom.strength > 0.4) {
            if (!thisMom || thisMom.momentum === 'flat') {
                // Related market is moving up, this one is flat = lagging opportunity
                bonus += 12;
                signals.push(`CrossMarket: correlated "${rel.sharedKeywords[0]}" moving up, this lagging (+12)`);
                break; // Only take one cross-market signal
            }
        }
    }

    return { bonus, signals };
}


// ============================================================
// 3. SMART ENTRY TIMING — Wait for dips, check spread
// ============================================================

/**
 * Calculate if now is a good entry moment based on recent price action.
 * Returns: { shouldWait: bool, reason: string, adjustment: number }
 */
export function evaluateEntryTiming(marketId) {
    const mem = marketMemory[marketId];
    if (!mem || mem.prices.length < 5) return { shouldWait: false, reason: 'No history', adjustment: 0 };

    const prices = mem.prices.slice(-10).map(p => p.p);
    const current = prices[prices.length - 1];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    // If current price is >2% above recent average = just spiked, wait for pullback
    const deviation = (current - avg) / avg;

    if (deviation > 0.02) {
        return {
            shouldWait: true,
            reason: `Price ${(deviation * 100).toFixed(1)}% above recent avg — wait for pullback`,
            adjustment: -0.08 // Reduce confidence if entering at a spike
        };
    }

    // If current price is below recent average = good entry (buying the dip)
    if (deviation < -0.01) {
        return {
            shouldWait: false,
            reason: `Price ${(Math.abs(deviation) * 100).toFixed(1)}% below avg — good entry`,
            adjustment: 0.05 // Boost for dip buying
        };
    }

    return { shouldWait: false, reason: 'Neutral timing', adjustment: 0 };
}

/**
 * Check spread quality before entry.
 * Returns conviction adjustment based on spread tightness.
 */
export async function evaluateSpreadQuality(market) {
    if (!market.clobTokenIds || market.clobTokenIds.length < 2) return { adjustment: 0, signal: null };

    try {
        const tokenId = market.clobTokenIds[0]; // YES token
        const orderBook = await getCLOBOrderBook(tokenId);
        if (!orderBook) return { adjustment: 0, signal: null };

        const spread = analyzeSpread(orderBook);
        if (!spread) return { adjustment: 0, signal: null };

        if (spread.spreadPercent < 1) {
            return { adjustment: 0.05, signal: `TightSpread ${spread.spreadPercent.toFixed(1)}% (+5)` };
        } else if (spread.spreadPercent > 5) {
            return { adjustment: -0.10, signal: `WideSpread ${spread.spreadPercent.toFixed(1)}% (-10)` };
        }

        return { adjustment: 0, signal: null };
    } catch {
        return { adjustment: 0, signal: null };
    }
}


// ============================================================
// 4. DCA — Dollar Cost Averaging (build position in steps)
// ============================================================

/**
 * Check if a market already has an open trade and if we should add to it.
 * DCA rules:
 * - Only add to trades with conviction score >= 60
 * - Max 2 add-ons per trade (total 3 entries)
 * - Only add if price has moved AGAINST us (averaging down) by at least 3%
 * - Each add-on is half the original size
 * Returns: { shouldDCA: bool, existingTrade: trade|null, reason: string }
 */
export function evaluateDCA(marketId) {
    const existingTrade = botState.activeTrades.find(t => t.marketId === marketId);
    if (!existingTrade) return { shouldDCA: false, existingTrade: null, reason: 'No existing position' };

    // Only DCA on high-conviction trades
    if ((existingTrade.convictionScore || 0) < 60) {
        return { shouldDCA: false, existingTrade, reason: 'Conviction too low for DCA' };
    }

    // Max 2 add-ons
    const dcaCount = existingTrade.dcaCount || 0;
    if (dcaCount >= 2) {
        return { shouldDCA: false, existingTrade, reason: 'Max DCA entries reached (3/3)' };
    }

    // Check if price moved against us by at least 3%
    const currentPrice = existingTrade.priceHistory?.length > 0
        ? existingTrade.priceHistory[existingTrade.priceHistory.length - 1]
        : null;

    if (!currentPrice) return { shouldDCA: false, existingTrade, reason: 'No current price' };

    const pnlPercent = (existingTrade.shares * currentPrice - existingTrade.amount) / existingTrade.amount;

    if (pnlPercent > -0.03) {
        return { shouldDCA: false, existingTrade, reason: `Not enough drawdown (${(pnlPercent * 100).toFixed(1)}%)` };
    }

    return {
        shouldDCA: true,
        existingTrade,
        reason: `DCA opportunity: ${(pnlPercent * 100).toFixed(1)}% down, entry #${dcaCount + 2}`
    };
}

/**
 * Execute a DCA add-on to an existing trade
 */
export function executeDCA(existingTrade, currentPrice) {
    const addOnSize = existingTrade.amount * 0.5; // Half the original size

    if (addOnSize < CONFIG.MIN_TRADE_SIZE || addOnSize > botState.capital) return null;

    const addOnShares = addOnSize / currentPrice;

    // Update existing trade
    existingTrade.amount += addOnSize;
    existingTrade.shares += addOnShares;
    existingTrade.dcaCount = (existingTrade.dcaCount || 0) + 1;

    // Recalculate average entry price
    existingTrade.entryPrice = existingTrade.amount / existingTrade.shares;

    // Deduct capital
    botState.capital -= addOnSize;
    existingTrade.reasons.push(`📊 DCA #${existingTrade.dcaCount}: +$${addOnSize.toFixed(0)} @ ${currentPrice.toFixed(3)}`);

    stateManager.save();
    addLog(botState, `📊 DCA: Added $${addOnSize.toFixed(0)} to "${existingTrade.question.substring(0, 25)}..." (Entry #${existingTrade.dcaCount + 1})`, 'trade');

    return { addOnSize, addOnShares, newAvgPrice: existingTrade.entryPrice };
}


// ============================================================
// 5. EVENT-DRIVEN TRADING — External catalysts boost
// ============================================================

// Track recent events that should boost certain market categories
const eventCatalysts = [];
const MAX_CATALYSTS = 20;

/**
 * Detect catalysts from PizzINT trends and market volume spikes
 */
export function detectCatalysts(pizzaData, markets) {
    if (!Array.isArray(markets)) return;

    const now = Date.now();

    // 1. PizzINT trend catalysts
    if (pizzaData?.trends && Array.isArray(pizzaData.trends)) {
        for (const trend of pizzaData.trends) {
            const trendText = (typeof trend === 'string' ? trend : trend.text || '').toLowerCase();
            if (trendText.length > 5) {
                eventCatalysts.push({
                    source: 'pizzint',
                    text: trendText,
                    timestamp: now,
                    categories: inferCategoriesFromText(trendText)
                });
            }
        }
    }

    // 2. Volume spike catalysts (market volume jumped 3x in recent memory)
    for (const market of markets) {
        const mem = marketMemory[market.id];
        if (!mem || mem.volumes.length < 5) continue;

        const volumes = mem.volumes.map(v => v.v);
        const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
        const currentVol = volumes[volumes.length - 1];

        if (avgVol > 0 && currentVol > avgVol * 3) {
            eventCatalysts.push({
                source: 'volume_spike',
                text: market.question.substring(0, 50),
                marketId: market.id,
                timestamp: now,
                categories: [categorizeMarket(market.question)],
                volumeMultiple: currentVol / avgVol
            });
        }
    }

    // Trim old catalysts (older than 2 hours)
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    while (eventCatalysts.length > 0 && eventCatalysts[0].timestamp < twoHoursAgo) {
        eventCatalysts.shift();
    }
    while (eventCatalysts.length > MAX_CATALYSTS) {
        eventCatalysts.shift();
    }
}

/**
 * Infer categories from event text
 */
function inferCategoriesFromText(text) {
    const categories = [];
    const geoKeywords = ['war', 'military', 'attack', 'strike', 'nuclear', 'russia', 'ukraine', 'china', 'iran', 'israel', 'nato'];
    const ecoKeywords = ['bitcoin', 'crypto', 'market', 'economy', 'fed', 'rate', 'inflation', 'gdp', 'stock', 'recession'];
    const polKeywords = ['trump', 'biden', 'election', 'congress', 'senate', 'vote', 'democrat', 'republican'];

    if (geoKeywords.some(k => text.includes(k))) categories.push('geopolitical');
    if (ecoKeywords.some(k => text.includes(k))) categories.push('economic');
    if (polKeywords.some(k => text.includes(k))) categories.push('political');

    return categories.length > 0 ? categories : ['other'];
}

/**
 * Get event-driven conviction bonus for a market
 */
export function getEventSignal(marketId, market) {
    if (eventCatalysts.length === 0) return { bonus: 0, signals: [] };

    const category = categorizeMarket(market?.question || '');
    const question = (market?.question || '').toLowerCase();
    let bonus = 0;
    const signals = [];

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    for (const catalyst of eventCatalysts) {
        if (catalyst.timestamp < oneHourAgo) continue; // Only recent catalysts

        // Category match
        if (catalyst.categories.includes(category)) {
            bonus += 8;
            signals.push(`Event: ${catalyst.source} "${catalyst.text.substring(0, 30)}..." → ${category} (+8)`);
        }

        // Direct market match (volume spike on this specific market)
        if (catalyst.marketId === marketId && catalyst.source === 'volume_spike') {
            bonus += 15;
            signals.push(`Event: volume spike ${catalyst.volumeMultiple.toFixed(1)}x on this market (+15)`);
        }

        // Keyword match in question
        const catalystWords = catalyst.text.split(/\s+/).filter(w => w.length >= 4);
        const questionMatch = catalystWords.some(w => question.includes(w));
        if (questionMatch && !signals.some(s => s.includes(catalyst.text.substring(0, 20)))) {
            bonus += 10;
            signals.push(`Event: keyword match "${catalyst.text.substring(0, 25)}..." (+10)`);
        }
    }

    // Cap event bonus at 25
    return { bonus: Math.min(bonus, 25), signals: signals.slice(0, 3) };
}


// ============================================================
// 6. ANTI-FRAGILITY — Structured drawdown recovery
// ============================================================

/**
 * Calculate the current drawdown state and return trading restrictions.
 * Uses a tiered recovery system:
 * - Tier 0 (Normal): No restrictions
 * - Tier 1 (Minor drawdown -3%): Only high conviction trades (>60pts)
 * - Tier 2 (Medium drawdown -5%): Only very high conviction (>70pts) + reduce size 50%
 * - Tier 3 (Severe drawdown -10%): Only arbitrage + reduce size 75%
 * Returns: { tier: 0-3, sizeMultiplier: 0.25-1.0, minConviction: 0-70, reason: string }
 */
export function getDrawdownRecoveryState() {
    const capital = botState.capital || CONFIG.STARTING_CAPITAL;
    const startingCapital = botState.startingCapital || CONFIG.STARTING_CAPITAL;
    const drawdownPercent = (startingCapital - capital) / startingCapital;

    // Also check recent performance (last 5 closed trades)
    const recentTrades = (botState.closedTrades || []).slice(0, 5);
    const recentWins = recentTrades.filter(t => (t.pnl || t.profit || 0) > 0).length;
    const recentLosses = recentTrades.length - recentWins;
    const onLosingStreak = recentLosses >= 3;

    if (drawdownPercent >= 0.10 || (onLosingStreak && drawdownPercent >= 0.05)) {
        return {
            tier: 3,
            sizeMultiplier: 0.25,
            minConviction: 70,
            reason: `SEVERE drawdown ${(drawdownPercent * 100).toFixed(1)}%${onLosingStreak ? ' + losing streak' : ''} — arbitrage/high conviction only`
        };
    }

    if (drawdownPercent >= 0.05) {
        return {
            tier: 2,
            sizeMultiplier: 0.50,
            minConviction: 60,
            reason: `MEDIUM drawdown ${(drawdownPercent * 100).toFixed(1)}% — high conviction only, half size`
        };
    }

    if (drawdownPercent >= 0.03 || onLosingStreak) {
        return {
            tier: 1,
            sizeMultiplier: 0.75,
            minConviction: 40,
            reason: `MINOR drawdown ${(drawdownPercent * 100).toFixed(1)}%${onLosingStreak ? ' + losing streak' : ''} — moderate caution`
        };
    }

    return { tier: 0, sizeMultiplier: 1.0, minConviction: 0, reason: 'Normal operations' };
}


// ============================================================
// 7. CALENDAR AWARENESS — Time-based trading adjustments
// ============================================================

/**
 * Get time-based trading adjustments.
 * Returns: { shouldTrade: bool, sizeMultiplier: 0.5-1.2, reason: string, signals: [] }
 */
export function getCalendarSignal() {
    const now = new Date();
    const hour = now.getUTCHours();
    const dayOfWeek = now.getUTCDay(); // 0=Sunday
    const dayOfMonth = now.getUTCDate();

    let sizeMultiplier = 1.0;
    const signals = [];

    // Weekend: Lower volume, wider spreads → reduce size
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        sizeMultiplier *= 0.7;
        signals.push('Calendar: weekend (-30% size)');
    }

    // Late night / early morning UTC (00-06): Very low volume
    if (hour >= 0 && hour < 6) {
        sizeMultiplier *= 0.8;
        signals.push('Calendar: off-hours UTC (-20% size)');
    }

    // US market hours (14-21 UTC = 9am-4pm EST): Peak activity
    if (hour >= 14 && hour <= 21 && dayOfWeek >= 1 && dayOfWeek <= 5) {
        sizeMultiplier *= 1.1;
        signals.push('Calendar: US market hours (+10% size)');
    }

    // First Friday of month: US jobs report → economic volatility
    if (dayOfWeek === 5 && dayOfMonth <= 7) {
        signals.push('Calendar: Jobs Friday — expect economic volatility');
    }

    // Month-end (last 2 days): Position squaring, higher volume
    const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
    if (dayOfMonth >= daysInMonth - 1) {
        sizeMultiplier *= 0.9;
        signals.push('Calendar: month-end position squaring (-10% size)');
    }

    return {
        shouldTrade: true, // Always allow, just adjust size
        sizeMultiplier: Math.max(0.5, Math.min(1.2, sizeMultiplier)),
        signals
    };
}


// ============================================================
// MASTER INTEGRATION: Combined signal from all 7 strategies
// ============================================================

/**
 * Get combined advanced signal for a market.
 * Called from engine.js conviction scoring to add bonus points.
 * Returns: { bonus: number, signals: string[], sizeMultiplier: number, shouldReject: bool, rejectReason: string }
 */
export async function getAdvancedSignals(market, pizzaData, convictionPoints) {
    let totalBonus = 0;
    const allSignals = [];
    let sizeMultiplier = 1.0;

    // 1. Market Memory
    const memSignal = getMemorySignal(market.id);
    totalBonus += memSignal.bonus;
    allSignals.push(...memSignal.signals);

    // 2. Cross-Market Intelligence (uses cached correlation map)
    if (botState._correlationMap) {
        const crossSignal = getCrossMarketSignal(market.id, botState._correlationMap);
        totalBonus += crossSignal.bonus;
        allSignals.push(...crossSignal.signals);
    }

    // 3. Smart Entry Timing
    const timing = evaluateEntryTiming(market.id);
    if (timing.adjustment !== 0) {
        // Convert timing adjustment to conviction points (roughly 1% confidence = 5 conviction points)
        const timingBonus = Math.round(timing.adjustment * 50);
        totalBonus += timingBonus;
        allSignals.push(`Timing: ${timing.reason} (${timingBonus > 0 ? '+' : ''}${timingBonus})`);
    }

    // 4. Spread Quality
    const spreadResult = await evaluateSpreadQuality(market);
    if (spreadResult.signal) {
        const spreadBonus = Math.round(spreadResult.adjustment * 50);
        totalBonus += spreadBonus;
        allSignals.push(spreadResult.signal);
    }

    // 5. Event-Driven
    const eventSignal = getEventSignal(market.id, market);
    totalBonus += eventSignal.bonus;
    allSignals.push(...eventSignal.signals);

    // 6. Anti-Fragility (can reject trades)
    const recovery = getDrawdownRecoveryState();
    if (recovery.tier > 0) {
        sizeMultiplier *= recovery.sizeMultiplier;
        allSignals.push(`🛡️ Recovery Tier ${recovery.tier}: ${recovery.reason}`);

        // Check if conviction meets minimum for current recovery tier
        const totalConviction = convictionPoints + totalBonus;
        if (totalConviction < recovery.minConviction) {
            return {
                bonus: totalBonus,
                signals: allSignals,
                sizeMultiplier,
                shouldReject: true,
                rejectReason: `Recovery Tier ${recovery.tier}: conviction ${totalConviction} < min ${recovery.minConviction}`
            };
        }
    }

    // 7. Calendar Awareness
    const calendar = getCalendarSignal();
    sizeMultiplier *= calendar.sizeMultiplier;
    allSignals.push(...calendar.signals);

    return {
        bonus: totalBonus,
        signals: allSignals,
        sizeMultiplier,
        shouldReject: false,
        rejectReason: null
    };
}
