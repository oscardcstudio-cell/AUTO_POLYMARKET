
import { addLog } from '../utils.js';

// --- Tension history for trend detection ---
const tensionHistory = []; // Max 60 entries (~1h at 1min intervals)
const MAX_HISTORY = 60;

// --- OSINT sources for supplementary geopolitical intelligence ---
const OSINT_SOURCES = [
    { name: 'ISW',        url: 'https://www.understandingwar.org/rss.xml', weight: 1.5 },
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/',         weight: 1.2 },
];

const OSINT_ESCALATION_KEYWORDS = [
    'attack', 'offensive', 'assault', 'invasion', 'conflict', 'escalat',
    'missile', 'airstrike', 'bombing', 'troops', 'military', 'combat',
    'casualties', 'killed', 'destroyed', 'captured', 'advance', 'war',
];
const OSINT_DEESCALATION_KEYWORDS = [
    'ceasefire', 'peace', 'negotiations', 'withdraw', 'retreat',
    'agreement', 'diplomacy', 'talks', 'deal', 'truce',
];

// Cache OSINT score 15 minutes to avoid hammering RSS feeds
let osintCache = { score: 0, timestamp: 0 };
const OSINT_CACHE_TTL = 15 * 60 * 1000;

/**
 * Fetch OSINT geopolitical tension score from ISW and Bellingcat RSS feeds.
 * Returns a supplementary score (0-10) that boosts the PizzINT tension score.
 */
async function fetchOSINTScore() {
    if (Date.now() - osintCache.timestamp < OSINT_CACHE_TTL) {
        return osintCache.score;
    }

    let totalScore = 0;
    let totalWeight = 0;

    for (const source of OSINT_SOURCES) {
        try {
            const response = await fetchWithRetry(source.url);
            if (!response.ok) continue;

            const xml = await response.text();
            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            const items = [];
            let match;
            while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
                items.push(match[1]);
            }
            if (items.length === 0) continue;

            let sourceScore = 0;
            for (const item of items) {
                const titleMatch = item.match(/<title[^>]*>([\s\S]*?)<\/title>/);
                const descMatch  = item.match(/<description[^>]*>([\s\S]*?)<\/description>/);
                const rawText = ((titleMatch?.[1] || '') + ' ' + (descMatch?.[1] || ''))
                    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
                    .replace(/<[^>]+>/g, ' ').toLowerCase();

                let itemScore = 0;
                for (const kw of OSINT_ESCALATION_KEYWORDS)   { if (rawText.includes(kw)) itemScore += 2; }
                for (const kw of OSINT_DEESCALATION_KEYWORDS) { if (rawText.includes(kw)) itemScore -= 1; }
                sourceScore += Math.max(0, itemScore);
            }

            // Normalize to 0-10 per source
            const normalized = Math.min((sourceScore / items.length) * 2, 10);
            totalScore  += normalized * source.weight;
            totalWeight += source.weight;
        } catch { /* fail silently — OSINT is supplementary */ }
    }

    const finalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
    osintCache = { score: finalScore, timestamp: Date.now() };
    return finalScore;
}

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

/**
 * Compute composite tension score (0-100) from PizzINT defcon_details and spike data.
 * Combines: intensity, breadth, spike severity, sustained/sentinel flags,
 * night multiplier, multi-site correlation, and persistence.
 */
function computeTensionScore(defconDetails, activeSpikes) {
    if (!defconDetails) return 0;

    const d = defconDetails;
    let score = 0;

    // Base: intensity + breadth (0-40 points)
    score += Math.min((d.intensity_score || 0) * 20, 20);
    score += Math.min((d.breadth_score || 0) * 20, 20);

    // Spike severity (0-25 points)
    const extremePts = Math.min((d.extreme_count || 0) * 10, 20);
    const highPts = extremePts > 0 ? 0 : Math.min((d.high_count || 0) * 5, 10);
    score += extremePts + highPts;
    // Moderate spikes from active_spikes count (smaller contribution)
    if (activeSpikes > 0 && extremePts === 0 && highPts === 0) {
        score += Math.min(activeSpikes * 2, 5);
    }

    // Sustained / sentinel flags (0-15 points)
    if (d.sustained) score += 10;
    if (d.sentinel) score += 15;

    // Multi-site correlation (0-10 points)
    const above150 = d.places_above_150 || 0;
    if (above150 >= 3) score += 10;
    else if (above150 >= 2) score += 5;

    // Persistence factor (0-10 points)
    const persistence = d.persistence_factor || 1;
    score += Math.min(Math.max((persistence - 1) * 10, 0), 10);

    // Night multiplier amplification (1.0-1.5x)
    const nightMult = Math.min(Math.max(d.night_multiplier || 1, 1.0), 1.5);
    score *= nightMult;

    return Math.round(Math.min(Math.max(score, 0), 100));
}

/**
 * Compute tension trend from history.
 * Compares average of last 5 readings to previous 5.
 * RISING = last5 avg > prev5 avg + 5
 * FALLING = last5 avg < prev5 avg - 5
 * STABLE = otherwise
 */
function computeTensionTrend() {
    if (tensionHistory.length < 10) return 'STABLE';

    const last5 = tensionHistory.slice(-5);
    const prev5 = tensionHistory.slice(-10, -5);

    const avgLast = last5.reduce((s, h) => s + h.tensionScore, 0) / 5;
    const avgPrev = prev5.reduce((s, h) => s + h.tensionScore, 0) / 5;

    if (avgLast > avgPrev + 5) return 'RISING';
    if (avgLast < avgPrev - 5) return 'FALLING';
    return 'STABLE';
}

/**
 * Fetch and parse full PizzINT dashboard data.
 * Returns enriched object with tension score, spike details, venue data, and trend history.
 * Maintains backward compatibility: index, defcon, trends fields preserved.
 */
export async function getPizzaData() {
    try {
        const response = await fetchWithRetry('https://www.pizzint.watch/api/dashboard-data');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        // --- Fix field mapping (API returns overall_index / defcon_level, not globalIndex / defconLevel) ---
        const index = data.overall_index ?? 50;
        const defcon = data.defcon_level ?? 5;
        const defconDetails = data.defcon_details || null;

        // --- Parse events into trends (backward compat) ---
        const events = Array.isArray(data.events) ? data.events : [];
        const trends = events.map(e => e.place_name
            ? `${e.spike_magnitude || 'ACTIVITY'} at ${e.place_name} (${e.percentage_of_usual || 0}% of usual)`
            : ''
        ).filter(t => t.length > 0);

        // --- Also include any raw trends if the API ever provides them ---
        if (Array.isArray(data.trends)) {
            for (const t of data.trends) {
                const text = typeof t === 'string' ? t : (t.text || '');
                if (text.length > 5) trends.push(text);
            }
        }

        // --- Parse spike data ---
        const spikes = {
            active: data.active_spikes || 0,
            hasActive: data.has_active_spikes || false,
            events: events.map(e => ({
                placeName: e.place_name || 'Unknown',
                magnitude: e.spike_magnitude || 'NONE',
                percentOfUsual: e.percentage_of_usual || 0,
                minutesAgo: e.minutes_ago || 0,
            })),
        };

        // --- Parse venue data ---
        const rawVenues = Array.isArray(data.data) ? data.data : [];
        const venues = rawVenues.map(v => ({
            name: v.name || 'Unknown',
            currentPopularity: v.current_popularity || 0,
            percentOfUsual: v.percentage_of_usual || 0,
            isSpike: v.is_spike || false,
            spikeMagnitude: v.spike_magnitude || null,
            dataFreshness: v.data_freshness || 'unknown',
            isClosed: v.is_closed_now || false,
        }));

        // --- Compute tension score ---
        const tensionScore = computeTensionScore(defconDetails, spikes.active);

        // --- Boost with OSINT supplementary data (ISW + Bellingcat) ---
        const osintBoost = await fetchOSINTScore();
        // 90% PizzINT + 10% OSINT boost (capped at +10 pts)
        const blendedTensionScore = Math.min(100, Math.round(tensionScore * 0.9 + osintBoost));

        // --- Update history and compute trend ---
        tensionHistory.push({
            timestamp: Date.now(),
            tensionScore: blendedTensionScore,
            defcon,
        });
        while (tensionHistory.length > MAX_HISTORY) tensionHistory.shift();
        const tensionTrend = computeTensionTrend();

        return {
            // Legacy fields (backward compatible)
            index,
            defcon,
            trends,

            // Composite tension score (0-100) — blended PizzINT + OSINT
            tensionScore: blendedTensionScore,
            tensionScoreRaw: tensionScore,  // PizzINT-only score for reference
            osintBoost,                     // OSINT contribution (0-10)
            tensionTrend,

            // Rich DEFCON details
            defconDetails: defconDetails ? {
                severity: defconDetails.defcon_severity_decimal || 0,
                rawIndex: defconDetails.raw_index || 0,
                smoothedIndex: defconDetails.smoothed_index || 0,
                intensityScore: defconDetails.intensity_score || 0,
                breadthScore: defconDetails.breadth_score || 0,
                nightMultiplier: defconDetails.night_multiplier || 1,
                persistenceFactor: defconDetails.persistence_factor || 1,
                sustained: defconDetails.sustained || false,
                sentinel: defconDetails.sentinel || false,
                placesAbove150: defconDetails.places_above_150 || 0,
                placesAbove200: defconDetails.places_above_200 || 0,
                highCount: defconDetails.high_count || 0,
                extremeCount: defconDetails.extreme_count || 0,
                maxPct: defconDetails.max_pct || 0,
            } : null,

            // Spike intelligence
            spikes,

            // Venue data
            venues,

            // Data quality
            dataFreshness: data.data_freshness || 'unknown',

            // Trend history snapshot (last 10 for consumers)
            history: tensionHistory.slice(-10).map(h => ({ ...h })),
        };
    } catch (e) {
        return null;
    }
}
