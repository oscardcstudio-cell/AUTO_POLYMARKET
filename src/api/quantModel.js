/**
 * quantModel.js — Stratégie Quantitative Pure
 *
 * Specialized probabilistic model for election / vote / political markets.
 * Combines 4 independent signal layers to estimate a fair-value probability,
 * then compares it to the current Polymarket price.
 *
 * Trade only when |P_bot − P_market| > MIN_EDGE (4 %).
 *
 * ─────────────────────────────────────────────────────────────────
 * LAYER 1 — POLL SIGNAL
 *   Parse Google News RSS titles/descriptions for poll percentages
 *   and lead margins. No paid API required.
 *
 * LAYER 2 — HISTORICAL BASE RATE
 *   Hard-coded calibrated priors: incumbents, challengers,
 *   party advantages, referendum patterns.
 *
 * LAYER 3 — MARKET VOLATILITY
 *   Use Market Memory to measure price stability.
 *   High volatility → wider uncertainty → smaller edge weight.
 *
 * LAYER 4 — MEDIA BIAS
 *   Detect one-sided news coverage (>75 % same sentiment).
 *   Contrarian signal: market may already over-price the favourite.
 * ─────────────────────────────────────────────────────────────────
 */

import { detectMomentum, detectPriceRange } from '../logic/advancedStrategies.js';

// ──────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────────────────────

const MIN_EDGE       = 0.04;  // 4 % minimum edge to fire a signal
const MAX_ADJ        = 0.30;  // cap total adjustment at ±30 %

// Layer weights (must sum to 1.0)
const W_POLL         = 0.40;  // Poll signal is the strongest layer
const W_HISTORY      = 0.25;  // Historical base rates
const W_MOMENTUM     = 0.20;  // Market memory / price trend
const W_MEDIA        = 0.15;  // Media bias (contrarian)

// ──────────────────────────────────────────────────────────────────────────────
// ELECTION MARKET DETECTION
// ──────────────────────────────────────────────────────────────────────────────

const ELECTION_KEYWORDS = [
    'election', 'elect', 'win the', 'presidential', 'president',
    'senator', 'senate', 'congress', 'representative', 'prime minister',
    'parliament', 'referendum', 'vote', 'ballot', 'candidate',
    'republican', 'democrat', 'labour', 'conservative', 'party',
    'governor', 'mayor', 'nomination', 'primary', 'caucus',
    'polling', 'polls show', 'ahead in polls',
];

/**
 * Returns true if this market is an election / political outcome market.
 */
export function isElectionMarket(market) {
    const q = (market.question || '').toLowerCase();
    return ELECTION_KEYWORDS.some(kw => q.includes(kw));
}

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 1 — POLL SIGNAL
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Historical poll accuracy: polls tend to be biased toward the favourite
 * by ~2–3 % on average (enthusiasm gap, non-response bias).
 * We discount the raw poll signal by this factor.
 */
const POLL_DISCOUNT = 0.03;

/**
 * Parse a text string (news title or description) for poll percentages.
 * Returns: { pct: number|null, margin: number|null, direction: 'YES'|'NO'|null }
 */
function parseNewsForPolls(text) {
    if (!text) return { pct: null, margin: null, direction: null };
    const lower = text.toLowerCase();

    // ── Margin pattern: "leads by X points / percent" ─────────────────────
    const marginMatch = lower.match(/(?:leads?|ahead|up)\s+by\s+(\d+(?:\.\d+)?)\s*(?:point|pt|%)/);
    if (marginMatch) {
        const margin = parseFloat(marginMatch[1]) / 100;
        return { pct: null, margin, direction: 'YES' };
    }

    const trailMatch = lower.match(/(?:trails?|behind|down)\s+by\s+(\d+(?:\.\d+)?)\s*(?:point|pt|%)/);
    if (trailMatch) {
        const margin = parseFloat(trailMatch[1]) / 100;
        return { pct: null, margin, direction: 'NO' };
    }

    // ── Direct percentage pattern: "X at 52%", "polling at 52%" ──────────
    const pctPattern = /\b(\d{2,3}(?:\.\d+)?)\s*%/g;
    const allPcts = [];
    let m;
    while ((m = pctPattern.exec(text)) !== null) {
        const v = parseFloat(m[1]);
        if (v >= 5 && v <= 95) allPcts.push(v);
    }

    if (allPcts.length === 1) {
        // Single percentage — likely the YES side
        return { pct: allPcts[0] / 100, margin: null, direction: allPcts[0] >= 50 ? 'YES' : 'NO' };
    }
    if (allPcts.length >= 2) {
        // Two percentages — pick the first (usually the subject of the headline)
        return { pct: allPcts[0] / 100, margin: null, direction: allPcts[0] >= 50 ? 'YES' : 'NO' };
    }

    return { pct: null, margin: null, direction: null };
}

/**
 * Aggregate all news items matched to this market and extract a poll signal.
 * Returns: { pollImpliedP: number|null, confidence: 0–1, sources: string[] }
 */
function extractPollSignal(market, newsSentiment) {
    const sources = [];
    const estimates = [];

    const allNews = [
        ...(market._newsMatch?.articles || []),
        ...(newsSentiment || []).filter(n =>
            n.matched &&
            (n.keywords || []).some(kw => {
                const q = (market.question || '').toLowerCase();
                return q.includes(kw.toLowerCase());
            })
        ),
    ];

    // Also scan top-level news titles that mention the market question keywords
    const questionWords = (market.question || '')
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 4);

    for (const item of allNews) {
        const text = `${item.title || ''} ${item.description || ''}`;
        const parsed = parseNewsForPolls(text);

        if (parsed.pct !== null) {
            estimates.push(parsed.pct);
            sources.push(`Poll pct ${(parsed.pct * 100).toFixed(0)}% from "${(item.title || '').substring(0, 50)}"`);
        } else if (parsed.margin !== null) {
            // Margin alone: estimate P ~ 0.5 + margin/2 (roughly)
            const implied = parsed.direction === 'YES'
                ? Math.min(0.90, 0.50 + parsed.margin / 2)
                : Math.max(0.10, 0.50 - parsed.margin / 2);
            estimates.push(implied);
            sources.push(`Poll margin ${parsed.direction === 'YES' ? '+' : '-'}${(parsed.margin * 100).toFixed(0)}% → P~${(implied * 100).toFixed(0)}%`);
        }
    }

    if (estimates.length === 0) return { pollImpliedP: null, confidence: 0, sources: [] };

    // Average of all poll estimates, discounted for systematic poll bias
    const rawAvg = estimates.reduce((a, b) => a + b, 0) / estimates.length;
    const discounted = rawAvg - POLL_DISCOUNT; // slight discount for favourite over-representation

    return {
        pollImpliedP: Math.max(0.05, Math.min(0.95, discounted)),
        confidence:   Math.min(1.0, estimates.length / 3), // 3+ sources = full confidence
        sources,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 2 — HISTORICAL BASE RATES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calibrated base-rate priors for different market contexts.
 * Based on published political science research.
 */
const BASE_RATES = {
    // US Incumbents (seeking re-election)
    us_incumbent_president:  0.68,   // Historical US presidential incumbent win rate
    us_incumbent_senate:     0.80,   // Senate incumbents
    us_incumbent_house:      0.89,   // House incumbents
    us_incumbent_governor:   0.75,

    // UK / European
    uk_governing_party:      0.52,   // Slight incumbency edge in UK general elections
    eu_incumbent:            0.60,

    // Generic patterns
    frontrunner_in_question: 0.66,   // "Will X win?" when X is named first (usually the favourite)
    challenger:              0.34,   // Opposite of frontrunner
    two_party_tossup:        0.50,   // No clear info → 50/50
    referendum_status_quo:   0.55,   // Status quo (NO) side slightly favoured in referendums
};

/**
 * Detect base rate context from market question.
 * Returns { baseRate: number, contextLabel: string }
 */
function detectBaseRate(market) {
    const q = (market.question || '').toLowerCase();

    // ── US incumbents ─────────────────────────────────────────────────────
    if (/\bpresident\b/.test(q) && /\bwin\b|\bre.elect/.test(q)) {
        if (/trump|biden|harris|obama|bush/.test(q)) {
            return { baseRate: BASE_RATES.us_incumbent_president, contextLabel: 'US pres incumbent' };
        }
    }
    if (/\bsenate\b/.test(q) && /\bincumbent\b|\bre.elect/.test(q)) {
        return { baseRate: BASE_RATES.us_incumbent_senate, contextLabel: 'US senate incumbent' };
    }
    if (/\bgovernor\b/.test(q) && /\bincumbent\b|\bre.elect/.test(q)) {
        return { baseRate: BASE_RATES.us_incumbent_governor, contextLabel: 'US governor incumbent' };
    }

    // ── Referendum patterns ───────────────────────────────────────────────
    if (/\breferendum\b|\bvote (to|on)\b/.test(q)) {
        return { baseRate: BASE_RATES.referendum_status_quo, contextLabel: 'Referendum (status quo bias)' };
    }

    // ── UK elections ──────────────────────────────────────────────────────
    if (/\buk\b|\bbritish\b|\bparliament\b|\bconservative\b|\blabour\b/.test(q)) {
        return { baseRate: BASE_RATES.uk_governing_party, contextLabel: 'UK/EU election' };
    }

    // ── Generic: named first candidate in question usually = favourite ─────
    if (/\bwill\s+\w+\s+win\b/.test(q)) {
        return { baseRate: BASE_RATES.frontrunner_in_question, contextLabel: 'Named candidate (frontrunner)' };
    }

    // ── Default: toss-up ─────────────────────────────────────────────────
    return { baseRate: BASE_RATES.two_party_tossup, contextLabel: 'Toss-up (no prior)' };
}

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 3 — MARKET VOLATILITY
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compute a volatility confidence multiplier from Market Memory.
 * High volatility = less reliable signal → lower weight.
 * Returns: { volatilityMultiplier: 0–1, label: string }
 */
function computeVolatilityFactor(marketId) {
    const range = detectPriceRange(marketId);
    const momentum = detectMomentum(marketId);

    if (!range && !momentum) {
        return { volatilityMultiplier: 0.7, label: 'Insufficient data (default)' };
    }

    // High range = high uncertainty → reduce confidence
    if (range) {
        if (range.rangePercent > 0.25) return { volatilityMultiplier: 0.4, label: `High volatility (range ${(range.rangePercent * 100).toFixed(0)}%)` };
        if (range.rangePercent > 0.12) return { volatilityMultiplier: 0.65, label: `Medium volatility (range ${(range.rangePercent * 100).toFixed(0)}%)` };
        return { volatilityMultiplier: 0.90, label: `Low volatility (range ${(range.rangePercent * 100).toFixed(0)}%)` };
    }

    // Accelerating momentum → uncertain → moderate confidence
    if (momentum?.momentum === 'accelerating_up' || momentum?.momentum === 'accelerating_down') {
        return { volatilityMultiplier: 0.55, label: 'Accelerating momentum (uncertain)' };
    }

    return { volatilityMultiplier: 0.80, label: 'Stable momentum' };
}

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 4 — MEDIA BIAS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Detect one-sided media coverage for this market.
 * When >75 % of articles lean one way, the market may already over-price
 * the media favourite → contrarian signal.
 *
 * Returns: { biasAdj: number, biasLabel: string }
 *   biasAdj > 0 → contrarian buy (market overpriced from media hype → fade it)
 *   biasAdj < 0 → contrarian sell (market underpriced the media-neglected side)
 */
function detectMediaBias(market, newsSentiment) {
    const articles = [
        ...(market._newsMatch?.articles || []),
        ...(newsSentiment || []).filter(n => {
            const q = (market.question || '').toLowerCase();
            return (n.keywords || []).some(kw => q.includes(kw.toLowerCase()));
        }),
    ];

    if (articles.length < 3) return { biasAdj: 0, biasLabel: 'Insufficient articles' };

    const bullish = articles.filter(a => a.sentiment === 'bullish').length;
    const bearish = articles.filter(a => a.sentiment === 'bearish').length;
    const total   = bullish + bearish;
    if (total === 0) return { biasAdj: 0, biasLabel: 'No directional articles' };

    const bullishRatio = bullish / total;

    // Strongly one-sided toward YES (>75 % bullish) → market may be overpriced
    // Contrarian: reduce P_bot slightly (fade the hype)
    if (bullishRatio > 0.75) {
        const adj = -(bullishRatio - 0.75) * 0.20; // up to -5% adjustment
        return {
            biasAdj:   adj,
            biasLabel: `Media bias YES (${bullish}/${total} = ${(bullishRatio * 100).toFixed(0)}%) → contrarian ${(adj * 100).toFixed(1)}%`,
        };
    }

    // Strongly one-sided toward NO (>75 % bearish) → market may be underpriced
    if (bullishRatio < 0.25) {
        const adj = (0.25 - bullishRatio) * 0.20; // up to +5% adjustment
        return {
            biasAdj:   adj,
            biasLabel: `Media bias NO (${bearish}/${total} = ${((1 - bullishRatio) * 100).toFixed(0)}%) → contrarian +${(adj * 100).toFixed(1)}%`,
        };
    }

    return { biasAdj: 0, biasLabel: `Balanced coverage (${(bullishRatio * 100).toFixed(0)}% bullish)` };
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Run the full Quantitative Pure model on a market.
 *
 * @param {Object} market        — Polymarket market object (with _newsMatch attached)
 * @param {Array}  newsSentiment — botState.newsSentiment array
 * @returns {{
 *   applicable: boolean,       // false if market is not an election/vote type
 *   pBot:       number,        // our estimated YES probability
 *   pMarket:    number,        // current market price
 *   edge:       number,        // P_bot - P_market (signed)
 *   signal:     'buy'|'sell'|'neutral',
 *   confidence: 0–1,           // overall model confidence
 *   alphaBonus: number,
 *   layers:     object,        // breakdown by layer (for dashboard / debugging)
 *   reasons:    string[]
 * }}
 */
export function runQuantModel(market, newsSentiment = []) {
    const NOT_APPLICABLE = {
        applicable: false, pBot: 0.5, pMarket: 0.5,
        edge: 0, signal: 'neutral', confidence: 0, alphaBonus: 0,
        layers: {}, reasons: [],
    };

    // ── Gate: only run on election / political markets ────────────────────
    if (!isElectionMarket(market)) return NOT_APPLICABLE;

    // ── Read current market price ─────────────────────────────────────────
    let pMarket = 0.5;
    try {
        const prices = typeof market.outcomePrices === 'string'
            ? JSON.parse(market.outcomePrices)
            : market.outcomePrices;
        pMarket = parseFloat(prices[0]);
        if (isNaN(pMarket)) return NOT_APPLICABLE;
    } catch {
        return NOT_APPLICABLE;
    }

    const reasons = [];

    // ── LAYER 1: Poll Signal ──────────────────────────────────────────────
    const pollSignal    = extractPollSignal(market, newsSentiment);
    const pollImplied   = pollSignal.pollImpliedP;
    const pollConf      = pollSignal.confidence;

    // ── LAYER 2: Historical Base Rate ─────────────────────────────────────
    const { baseRate, contextLabel } = detectBaseRate(market);

    // ── LAYER 3: Market Volatility ────────────────────────────────────────
    const { volatilityMultiplier, label: volLabel } = computeVolatilityFactor(market.id);

    // ── LAYER 4: Media Bias ───────────────────────────────────────────────
    const { biasAdj, biasLabel } = detectMediaBias(market, newsSentiment);

    // ── Weighted combination ──────────────────────────────────────────────
    // If we have poll data, use it as the main anchor.
    // Otherwise fall back to base rate as anchor.
    let weightedP;
    let totalWeight = 0;

    if (pollImplied !== null && pollConf > 0.1) {
        // Use poll as primary anchor
        const pollW  = W_POLL  * pollConf * volatilityMultiplier;
        const histW  = W_HISTORY * (1 - pollConf * 0.5); // history less important when we have polls
        const momW   = W_MOMENTUM * volatilityMultiplier;

        weightedP   = pollImplied * pollW + baseRate * histW + pMarket * momW;
        totalWeight = pollW + histW + momW;

        reasons.push(`📊 Sondages: P_poll=${(pollImplied * 100).toFixed(0)}% (conf ${(pollConf * 100).toFixed(0)}%)`);
        for (const s of pollSignal.sources) reasons.push(`   └ ${s}`);
    } else {
        // No poll data — use base rate + market as anchors
        const histW = W_HISTORY * volatilityMultiplier;
        const momW  = W_MOMENTUM * volatilityMultiplier + W_POLL; // redistribute poll weight

        weightedP   = baseRate * histW + pMarket * momW;
        totalWeight = histW + momW;

        reasons.push(`📜 Historique: base rate ${(baseRate * 100).toFixed(0)}% (${contextLabel})`);
    }

    // Normalise
    if (totalWeight > 0) weightedP /= totalWeight;
    else weightedP = pMarket;

    // Apply media bias adjustment
    weightedP = Math.max(0.05, Math.min(0.95, weightedP + biasAdj));

    // ── Compute edge ──────────────────────────────────────────────────────
    const rawAdj = Math.max(-MAX_ADJ, Math.min(MAX_ADJ, weightedP - pMarket));
    const pBot   = Math.max(0.05, Math.min(0.95, pMarket + rawAdj));
    const edge   = pBot - pMarket;

    // ── Overall model confidence ──────────────────────────────────────────
    // Based on: number of data sources + volatility stability
    const dataScore     = pollImplied !== null ? (0.5 + pollConf * 0.5) : 0.3;
    const confidence    = Math.min(1.0, dataScore * volatilityMultiplier);

    // ── Signal ────────────────────────────────────────────────────────────
    // Dynamic threshold: higher volatility = higher required edge
    const dynamicMinEdge = MIN_EDGE + (1 - volatilityMultiplier) * 0.04;

    let signal     = 'neutral';
    let alphaBonus = 0;

    if (edge >= dynamicMinEdge && confidence >= 0.25) {
        signal     = 'buy';
        alphaBonus = Math.round(Math.min(35, edge * 350 * confidence));
        reasons.push(`💎 Quant Pure: P_bot=${(pBot * 100).toFixed(0)}% vs marché ${(pMarket * 100).toFixed(0)}% → edge +${(edge * 100).toFixed(0)}% → +${alphaBonus} alpha`);
    } else if (edge <= -dynamicMinEdge && confidence >= 0.25) {
        signal     = 'sell';
        alphaBonus = -Math.round(Math.min(25, Math.abs(edge) * 250 * confidence));
        reasons.push(`⚠️ Quant Pure: P_bot=${(pBot * 100).toFixed(0)}% vs marché ${(pMarket * 100).toFixed(0)}% → surévalué ${(Math.abs(edge) * 100).toFixed(0)}% → ${alphaBonus} alpha`);
    } else {
        reasons.push(`📐 Quant Pure: edge ${(edge * 100).toFixed(1)}% < seuil ${(dynamicMinEdge * 100).toFixed(1)}% (conf ${(confidence * 100).toFixed(0)}%) → neutre`);
    }

    // ── Log supporting details ────────────────────────────────────────────
    reasons.push(`🔬 ${volLabel}`);
    if (biasAdj !== 0) reasons.push(`📺 ${biasLabel}`);

    return {
        applicable: true,
        pBot,
        pMarket,
        edge,
        signal,
        confidence,
        alphaBonus,
        layers: {
            poll:      { p: pollImplied, confidence: pollConf, sources: pollSignal.sources },
            history:   { baseRate, contextLabel },
            volatility:{ multiplier: volatilityMultiplier, label: volLabel },
            mediaBias: { adj: biasAdj, label: biasLabel },
        },
        reasons,
    };
}
