/**
 * marketBehavior.js
 * Exploits behavioural anomalies on Polymarket:
 *
 * 1. HYPE FADER — Price has spiked irrationally (overbought popular candidate,
 *    overreaction to polls, etc.) → fade the hype, reduce alpha score
 *
 * 2. PANIC BUY — Price has dropped fast near resolution (J-3 or less),
 *    market overreacts → buy the dip (increase alpha score)
 *
 * 3. CALENDAR EDGE v2 — Stagnant uncertain market approaching resolution
 *    (< 7 days). Price has been flat → likely to move as resolution nears.
 *    Enter early, target 15% profit before binary outcome.
 *
 * All functions use the Market Memory (detectMomentum / detectPriceRange)
 * already maintained by advancedStrategies.js — zero extra API calls.
 */

import { detectMomentum, detectPriceRange } from '../logic/advancedStrategies.js';

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Safely extract YES probability from a market object.
 */
function getYesPrice(market) {
    try {
        const prices = typeof market.outcomePrices === 'string'
            ? JSON.parse(market.outcomePrices)
            : market.outcomePrices;
        const p = parseFloat(prices[0]);
        return isNaN(p) ? null : p;
    } catch {
        return null;
    }
}

/**
 * Days until market resolution. Returns null if endDate is missing / invalid.
 */
function daysUntilExpiry(market) {
    if (!market.endDate) return null;
    const msLeft = new Date(market.endDate) - Date.now();
    return msLeft / (1000 * 60 * 60 * 24);
}

// ──────────────────────────────────────────────────────────────────────────────
// 1.  HYPE / PANIC DETECTOR
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Detect behavioural anomalies driven by crowd emotions.
 *
 * @param {Object} market — Polymarket market object
 * @returns {{
 *   signal: 'hype'|'panic'|'none',
 *   strength: number,        // 0–1
 *   alphaBonus: number,      // negative for hype (caution), positive for panic (opportunity)
 *   volatilityBonus: number, // extra bonus for wide intraday range
 *   reasons: string[]
 * }}
 */
export function detectBehavioralAnomaly(market) {
    const result = {
        signal: 'none',
        strength: 0,
        alphaBonus: 0,
        volatilityBonus: 0,
        reasons: [],
    };

    const marketId = market.id;
    if (!marketId) return result;

    const yesPrice = getYesPrice(market);
    if (yesPrice === null) return result;

    const days = daysUntilExpiry(market);
    if (days === null) return result;

    const momentum = detectMomentum(marketId);  // May be null (insufficient data)
    const range    = detectPriceRange(marketId); // May be null (insufficient data)

    // ── HYPE DETECTION ────────────────────────────────────────────────────────
    // Condition: price is HIGH (> 62%) AND has been accelerating upward recently.
    // Polymarket consistently overprices popular candidates and overhypes news spikes.
    // Signal: reduce alpha (don't chase the hype — price likely to revert).
    if (momentum?.momentum === 'accelerating_up' && yesPrice > 0.62) {
        // strength = how overbought (0 at 62%, 1 at 92%)
        const strength = Math.min(1.0, momentum.strength * (yesPrice - 0.62) / 0.30);
        const penalty = -Math.round(strength * 22); // up to -22 alpha

        result.signal   = 'hype';
        result.strength = strength;
        result.alphaBonus = penalty;
        result.reasons.push(
            `🔥 Hype: prix ${(yesPrice * 100).toFixed(0)}% en hausse rapide — overbought (${penalty} alpha)`
        );
    }

    // ── PANIC SELL DETECTION ──────────────────────────────────────────────────
    // Condition: price has DROPPED FAST while resolution is close (< 3 days)
    // AND the market is genuinely uncertain (price 15–55%).
    // Signal: strong buying opportunity — markets overreact near resolution.
    if (
        momentum?.momentum === 'accelerating_down' &&
        days <= 3 &&
        days > 0 &&
        yesPrice >= 0.15 &&
        yesPrice <= 0.55
    ) {
        // strength = function of how close to resolution
        const proximity = Math.max(0, 1 - days / 3); // 0 at J-3, 1 at J-0
        const strength  = Math.min(1.0, momentum.strength * (0.5 + proximity));
        const bonus     = Math.round(strength * 28); // up to +28 alpha

        // Override hype signal if panic is stronger
        if (result.signal !== 'hype' || bonus > Math.abs(result.alphaBonus)) {
            result.signal     = 'panic';
            result.strength   = strength;
            result.alphaBonus = bonus;
            result.reasons.push(
                `😱 Panic sell: chute rapide à J-${days.toFixed(1)} (prix ${(yesPrice * 100).toFixed(0)}%) → opportunité d'achat (+${bonus})`
            );
        }
    }

    // ── INTRADAY VOLATILITY BONUS ─────────────────────────────────────────────
    // Wide range = market is alive and has price-discovery potential.
    // We add a small bonus regardless of hype/panic.
    if (range && range.rangePercent > 0.08) {
        const vBonus = range.rangePercent > 0.20 ? 10 : 6;
        result.volatilityBonus = vBonus;
        result.reasons.push(
            `📊 Volatilité intraday: range ${(range.rangePercent * 100).toFixed(0)}% (+${vBonus})`
        );
    }

    return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// 2.  CALENDAR EDGE v2
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Detect Calendar Edge opportunities:
 * - Market has been STAGNANT (flat price, no clear momentum)
 * - Market is UNCERTAIN (YES price 28–72%)
 * - Resolution is CLOSE (2–7 days)
 * → Enter now, target 15% profit BEFORE the binary resolution wipes out optionality.
 *
 * Also detects "Volume Awakening": volume starts picking up on a stagnant market
 * near resolution (market participants waking up → enter before the crowd).
 *
 * @param {Object} market
 * @returns {{
 *   isCalendarEdge: boolean,
 *   alphaBonus: number,
 *   earlyExitTarget: number|null,  // suggested exit price (absolute YES probability)
 *   reasons: string[]
 * }}
 */
export function detectCalendarEdge(market) {
    const result = {
        isCalendarEdge: false,
        alphaBonus: 0,
        earlyExitTarget: null,
        reasons: [],
    };

    const marketId = market.id;
    if (!marketId) return result;

    const yesPrice = getYesPrice(market);
    if (yesPrice === null) return result;

    const days = daysUntilExpiry(market);
    if (days === null) return result;

    // Only in the 2–7 day window
    if (days < 2 || days > 7) return result;

    const momentum = detectMomentum(marketId);
    const range    = detectPriceRange(marketId);

    // Market must be STAGNANT: no strong momentum
    const isStagnant =
        !momentum ||
        momentum.momentum === 'flat' ||
        (momentum.momentum === 'decelerating' && momentum.strength < 0.30);

    // Market must be UNCERTAIN: genuine binary outcome possible
    const isUncertain = yesPrice >= 0.28 && yesPrice <= 0.72;

    if (isStagnant && isUncertain) {
        // Bonus increases as resolution nears (more urgency to enter early)
        const proximity = 1 - (days - 2) / 5; // 0 at 7 days, 1 at 2 days
        const bonus = Math.round(16 + proximity * 16); // +16 to +32 alpha

        // Suggested early exit: 15% above current price
        // (profit harvested well before binary collapse at resolution)
        const earlyExitTarget = Math.min(0.85, yesPrice * 1.15);

        result.isCalendarEdge  = true;
        result.alphaBonus      = bonus;
        result.earlyExitTarget = earlyExitTarget;
        result.reasons.push(
            `📅 Calendar Edge: marché stagnant + incertain à J-${days.toFixed(1)} de résolution (+${bonus})`
        );
        result.reasons.push(
            `📅 Sortie cible recommandée: ${(earlyExitTarget * 100).toFixed(1)}% (avant résolution binaire)`
        );
    }

    // ── VOLUME AWAKENING bonus ────────────────────────────────────────────────
    // Even if not stagnant, if volume is picking up near resolution → early entry
    if (days <= 5 && isUncertain) {
        const volume24h  = parseFloat(market.volume24hr   || 0);
        const liquidity  = parseFloat(market.liquidityNum || 0);
        const volRatio   = volume24h / (liquidity + 1);

        // Volume ratio > 0.25 means the market is starting to move
        if (volRatio > 0.25) {
            const awakBonus = Math.round(volRatio > 0.60 ? 12 : 7);
            result.alphaBonus   += awakBonus;
            result.isCalendarEdge = true;
            result.reasons.push(
                `📅 Volume awakening: ratio ${volRatio.toFixed(2)} à J-${days.toFixed(1)} (+${awakBonus})`
            );
        }
    }

    return result;
}
