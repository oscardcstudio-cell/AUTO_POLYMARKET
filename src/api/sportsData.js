
/**
 * Sports Intelligence Module
 *
 * Calculates probability adjustments for sports markets using:
 *  1. 🏠 Home/Away advantage (base win rates by sport — statistical averages)
 *  2. 💡 Value detection (market price vs fair probability from base rates)
 *  3. 🤕 Injury/suspension signals (from news articles)
 *  4. 🔥 Form/momentum signals (from news articles)
 *  5. 🏆 Motivation boost (derby, elimination, title race, nothing-to-play-for)
 *  6. 🏟️ Neutral venue detection (cancels home advantage)
 *  7. ⚽ Sport type detection (determines base home win rate)
 *
 * No external sports API required — uses Google News RSS (already in botState)
 * and text analysis of the Polymarket market question.
 */

import { CONFIG } from '../config.js';

// ─── Base home win rates by sport (historical averages, major leagues) ──────────
// Soccer: Premier League / La Liga / Bundesliga averages (2015-2025)
// NBA: all seasons 2010-2024
// NFL: regular season 2010-2024
// MLB/NHL: regular season averages
export const BASE_HOME_WIN_RATES = {
    soccer: 0.46,
    football: 0.46,    // alias for soccer
    basketball: 0.60,
    nba: 0.60,
    nfl: 0.57,
    baseball: 0.54,
    mlb: 0.54,
    hockey: 0.55,
    nhl: 0.55,
    tennis: 0.50,      // No real home advantage in tennis
    esports: 0.50,     // No home advantage in esports
    default: 0.53,     // Conservative generic sports home advantage
};

// ─── Venue detection patterns ─────────────────────────────────────────────────
// "Home" = YES team plays at their home venue
const HOME_PATTERNS = [
    /\bat home\b/i, /\bhome game\b/i, /\bhome match\b/i,
    /\bhome side\b/i, /\bhost\b/i, /\bhosts\b/i,
];
// "Away" = YES team travels to opponent's venue
const AWAY_PATTERNS = [
    /\baway game\b/i, /\baway match\b/i, /\bon the road\b/i,
    /\btravel to\b/i, /\bvisit\b/i, /\bvisiting\b/i,
    /\bwin away\b/i,   // "win away against", "win away from home"
    /\bwin at [A-Z]/,  // "win at Anfield", "win at Madison Square Garden"
];
// "Neutral" = no home advantage (cup finals, World Cup, Olympics, international)
const NEUTRAL_PATTERNS = [
    /\bneutral venue\b/i, /\bneutral ground\b/i, /\bworld cup final\b/i,
    /\bolympic\b/i, /\bsuper bowl\b/i, /\bneutral\b/i,
];

// ─── Negative signals (injury, suspension, bad form) ─────────────────────────
const NEGATIVE_KEYWORDS = [
    'injur', 'injured', 'injury', ' out ', ' out,', ' out.', 'ruled out',
    'suspend', 'suspension', 'banned', 'doubt', 'miss ', 'missing',
    'absent', 'illness', 'sick', 'limping', 'crisis', 'sacked', 'fired',
    'losing streak', 'poor form', 'winless', 'struggle', 'relegation threat',
    'no win', 'worst run', 'collapsed', 'thrashed', 'humiliated',
];

// ─── Positive signals (form, momentum, strength) ─────────────────────────────
const POSITIVE_KEYWORDS = [
    'win streak', 'winning run', 'unbeaten', 'dominant', 'in form',
    'top form', 'on fire', 'peak', 'perfect record', 'league leaders',
    'top of the table', 'unstoppable', 'crushing', 'convincing win',
    'impressive', 'clinical', 'back to back', 'consecutive wins',
];

// ─── Motivation signals ───────────────────────────────────────────────────────
const HIGH_MOTIVATION_KEYWORDS = [
    'must win', 'must-win', 'elimination', 'relegation battle', 'final',
    'derby', 'rivalry', 'clasico', 'el clásico', 'title race', 'promotion battle',
    'knockout', 'quarter-final', 'quarterfinal', 'semi-final', 'semifinal',
    'championship game', 'do or die', 'last chance', 'pivotal',
];
const LOW_MOTIVATION_KEYWORDS = [
    'nothing to play for', 'mid-table comfort', 'garbage time',
    'end of season', 'rotate', 'resting starters', 'reserve squad',
    'dead rubber', 'already qualified', 'already relegated',
];

// ─── Sport type detection ─────────────────────────────────────────────────────
/**
 * Detect sport type from market question text
 * @param {string} question
 * @returns {string} sport key matching BASE_HOME_WIN_RATES
 */
export function detectSportType(question) {
    const q = question.toLowerCase();
    if (/\bnba\b|\bbasketball\b/.test(q)) return 'basketball';
    if (/\bnfl\b|\btouchdown\b|\bamerican football\b/.test(q)) return 'nfl';
    // Note: "super bowl" is NFL but played on neutral ground — handled by venue detector
    if (/\bmlb\b|\bbaseball\b|\bworld series\b/.test(q)) return 'baseball';
    if (/\bnhl\b|\bhockey\b|\bice hockey\b/.test(q)) return 'hockey';
    if (/\btennis\b|\bwimbledon\b|\bus open\b|\batp\b|\bwta\b|\bfrench open\b|\baustralia open\b/.test(q)) return 'tennis';
    if (/\besports\b|\bcounter.strike\b|\bcs2\b|\blol:\b|\bleague of legends\b|\bdota\b|\bvalorant\b|\blck\b|\bbo[35]\b/.test(q)) return 'esports';
    if (/\bsoccer\b|\bfootball\b|\bpremier league\b|\bla liga\b|\bbundesliga\b|\bserie a\b|\bligue 1\b|\bchampions league\b|\beuropa league\b|\bfifa\b|\buefa\b/.test(q)) return 'soccer';
    return 'default';
}

// ─── Venue detection ──────────────────────────────────────────────────────────
/**
 * Detect whether the YES (primary) team plays at home, away, or neutral venue
 * @param {string} question
 * @returns {'HOME' | 'AWAY' | 'NEUTRAL' | 'UNKNOWN'}
 */
export function detectVenueStatus(question) {
    // Neutral check first (overrides home/away)
    if (NEUTRAL_PATTERNS.some(p => p.test(question))) return 'NEUTRAL';
    if (HOME_PATTERNS.some(p => p.test(question))) return 'HOME';
    if (AWAY_PATTERNS.some(p => p.test(question))) return 'AWAY';

    // Heuristic: "Will X win at Y?" → X is away team
    if (/\bwin at [A-Z]/i.test(question)) return 'AWAY';
    // "Will X beat Y?" / "Will X win against Y?" (no venue hint) → UNKNOWN
    return 'UNKNOWN';
}

// ─── Entity extraction ────────────────────────────────────────────────────────
/**
 * Extract primary team/player name from market question
 * Returns the YES side team for news analysis
 * @param {string} question
 * @returns {{ primary: string | null, opponent: string | null }}
 */
export function extractSportsEntities(question) {
    const patterns = [
        /will\s+(.+?)\s+(?:beat|defeat|win against|overcome|win vs\.?)\s+(.+?)[\?\.]/i,
        /^(.+?)\s+vs\.?\s+(.+?)[\?\.\s]/i,
        /will\s+(.+?)\s+to\s+(?:beat|defeat|win)\s+(.+?)[\?\.\s]/i,
    ];

    for (const pat of patterns) {
        const m = question.match(pat);
        if (m) {
            return {
                primary: m[1].trim().replace(/^(the|a|an)\s+/i, ''),
                opponent: m[2].trim().replace(/^(the|a|an)\s+/i, ''),
            };
        }
    }

    // Fallback: extract "Will [Name]..." pattern
    const simple = question.match(/will\s+([A-Z][a-zA-Z\s]+?)(?:\s+win|\s+beat|\s+score|\?)/i);
    if (simple) return {
        primary: simple[1].trim().replace(/^(the|a|an)\s+/i, ''),
        opponent: null,
    };

    return { primary: null, opponent: null };
}

// ─── News analysis ────────────────────────────────────────────────────────────
/**
 * Analyze news sentiment for a specific team/entity
 * @param {string} teamName  - Team name to search for in news
 * @param {Array}  newsData  - botState.newsSentiment array
 * @returns {{ pos: number, neg: number, motivation: number, signals: Array }}
 */
export function analyzeTeamNews(teamName, newsData) {
    if (!teamName || !Array.isArray(newsData) || newsData.length === 0) {
        return { pos: 0, neg: 0, motivation: 0, signals: [] };
    }

    // Strip leading articles ("the Lakers" → "lakers") for better news matching
    const teamLower = teamName.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
    // Only consider articles where the team name appears (at least 3 chars to avoid false matches)
    const relevant = teamLower.length < 3 ? [] : newsData.filter(n => {
        const text = ((n.title || '') + ' ' + (n.description || '') + ' ' + (n.market || '')).toLowerCase();
        return text.includes(teamLower);
    });

    let pos = 0, neg = 0, motivation = 0;
    const signals = [];

    for (const article of relevant) {
        const text = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();

        if (NEGATIVE_KEYWORDS.some(kw => text.includes(kw))) {
            neg++;
            const kw = NEGATIVE_KEYWORDS.find(k => text.includes(k));
            signals.push({ type: 'negative', keyword: kw, title: (article.title || '').substring(0, 70) });
        }
        if (POSITIVE_KEYWORDS.some(kw => text.includes(kw))) {
            pos++;
            const kw = POSITIVE_KEYWORDS.find(k => text.includes(k));
            signals.push({ type: 'positive', keyword: kw, title: (article.title || '').substring(0, 70) });
        }
        if (HIGH_MOTIVATION_KEYWORDS.some(kw => text.includes(kw))) {
            motivation += 1;
            signals.push({ type: 'motivation_high', title: (article.title || '').substring(0, 70) });
        }
        if (LOW_MOTIVATION_KEYWORDS.some(kw => text.includes(kw))) {
            motivation -= 1;
            signals.push({ type: 'motivation_low', title: (article.title || '').substring(0, 70) });
        }
    }

    return { pos, neg, motivation, signals, articleCount: relevant.length };
}

// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * Calculate sports-specific alpha bonus for a market.
 *
 * Called synchronously inside calculateAlphaScore() in signals.js
 * Uses botState.newsSentiment (already in memory, refreshed every 15min)
 *
 * @param {Object} market    - Polymarket market object
 * @param {Array}  newsData  - botState.newsSentiment array
 * @returns {{ alphaBonus: number, convictionBonus: number, reasons: string[], meta: Object }}
 */
export function calculateSportsBonus(market, newsData = []) {
    const S = CONFIG.SPORTS_STRATEGY || {};
    const HOME_RATES = S.HOME_WIN_RATES || BASE_HOME_WIN_RATES;

    const question = market.question || '';
    const marketPrice = parseFloat(market.price || 0.5);

    let alphaBonus = 0;
    let convictionBonus = 0;
    const reasons = [];

    // ── Step 1: Context detection ─────────────────────────────────────────────
    const sportType = detectSportType(question);
    // Tennis and esports have no home advantage concept — always treat as NEUTRAL
    const venueStatus = (sportType === 'tennis' || sportType === 'esports')
        ? 'NEUTRAL'
        : detectVenueStatus(question);
    const entities = extractSportsEntities(question);
    const baseHomeRate = HOME_RATES[sportType] || HOME_RATES.default || 0.53;
    const advantageMultiplier = S.HOME_ADVANTAGE_MULTIPLIER || 1.5;

    // ── Step 2: Home/Away advantage ───────────────────────────────────────────
    // Use fixed per-sport alpha (based on home vs away win rate differential)
    // e.g. soccer: home=46% vs away=27% → real advantage despite 46% < 50%
    const homeAdvantageMap = S.HOME_ADVANTAGE_ALPHA || {};
    const homeAlpha = homeAdvantageMap[sportType] ?? homeAdvantageMap.default ?? 9;

    if (venueStatus === 'HOME' && homeAlpha > 0) {
        alphaBonus += homeAlpha;
        convictionBonus += Math.round(homeAlpha / 3);
        reasons.push(`🏠 Domicile ${sportType} (avantage réel domicile): +${homeAlpha}`);

    } else if (venueStatus === 'AWAY' && homeAlpha > 0) {
        alphaBonus -= homeAlpha;
        reasons.push(`✈️ Extérieur ${sportType} (désavantage statistique): -${homeAlpha}`);

    } else if (venueStatus === 'NEUTRAL') {
        reasons.push(`🏟️ Terrain neutre — avantage domicile annulé`);
    }
    // UNKNOWN: no venue bonus applied

    // ── Step 3: Value detection (market price vs fair probability) ────────────
    // Only apply when we have a home advantage context to compare against
    if (venueStatus === 'HOME') {
        const fairProb = baseHomeRate; // what the probability SHOULD be
        const valueEdge = (fairProb - marketPrice) * 100; // positive = underpriced
        const valueMultiplier = S.VALUE_EDGE_MULTIPLIER || 1.2;
        const maxValueBonus = S.MAX_VALUE_BONUS || 20;

        if (valueEdge > 4) {
            // Market underestimates home team
            const bonus = Math.min(Math.round(valueEdge * valueMultiplier), maxValueBonus);
            alphaBonus += bonus;
            convictionBonus += Math.round(bonus / 2);
            reasons.push(`💡 Sous-coté: marché ${(marketPrice * 100).toFixed(0)}% vs base ${(fairProb * 100).toFixed(0)}%: +${bonus}`);
        } else if (valueEdge < -4) {
            // Market overestimates home team (favorite bias)
            const penalty = Math.max(Math.round(valueEdge * valueMultiplier), -maxValueBonus);
            alphaBonus += penalty;
            reasons.push(`⚠️ Surcoté: marché ${(marketPrice * 100).toFixed(0)}% vs base ${(fairProb * 100).toFixed(0)}%: ${penalty}`);
        }
    }

    // ── Step 4: Form & injury signals from news ───────────────────────────────
    if (entities.primary && newsData.length > 0) {
        const analysis = analyzeTeamNews(entities.primary, newsData);

        if (analysis.neg > 0) {
            const penaltyPerSignal = S.INJURY_PENALTY_PER_SIGNAL || 10;
            const maxPenalty = S.MAX_INJURY_PENALTY || 25;
            const penalty = -Math.min(analysis.neg * penaltyPerSignal, maxPenalty);
            alphaBonus += penalty;
            convictionBonus += Math.round(penalty / 3); // also hurts conviction
            reasons.push(`🤕 Signaux négatifs ×${analysis.neg} (blessure/forme): ${penalty}`);
        }

        if (analysis.pos > 0) {
            const bonusPerSignal = S.FORM_BONUS_PER_SIGNAL || 7;
            const maxBonus = S.MAX_FORM_BONUS || 18;
            const bonus = Math.min(analysis.pos * bonusPerSignal, maxBonus);
            alphaBonus += bonus;
            convictionBonus += Math.round(bonus / 3);
            reasons.push(`🔥 Bonne forme ×${analysis.pos} (news): +${bonus}`);
        }

        // ── Step 5: Motivation ─────────────────────────────────────────────────
        if (analysis.motivation > 0) {
            const motivBonus = analysis.motivation * (S.MOTIVATION_BONUS || 8);
            alphaBonus += motivBonus;
            reasons.push(`🏆 Haute motivation (derby/élim/titre): +${motivBonus}`);
        } else if (analysis.motivation < 0) {
            const motivPenalty = analysis.motivation * (S.MOTIVATION_BONUS || 8);
            alphaBonus += motivPenalty;
            reasons.push(`😴 Faible motivation (rien à jouer): ${motivPenalty}`);
        }
    }

    // ── Clamp final values ─────────────────────────────────────────────────────
    // Max ±40 alpha from sports intelligence, max ±15 conviction
    return {
        alphaBonus: Math.round(Math.max(-40, Math.min(40, alphaBonus))),
        convictionBonus: Math.round(Math.max(-15, Math.min(15, convictionBonus))),
        reasons,
        meta: { sportType, venueStatus, entities, baseHomeRate },
    };
}
