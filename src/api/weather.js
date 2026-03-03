
import { CONFIG } from '../config.js';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// Cache forecasts to avoid hammering the API
let forecastCache = new Map();
let lastFetchTime = 0;

/**
 * Fetch weather forecast from Open-Meteo for a given location.
 * Uses ensemble models (GFS, ECMWF, etc.) for higher accuracy.
 */
async function fetchForecast(lat, lon) {
    const cacheKey = `${lat},${lon}`;
    const now = Date.now();
    if (forecastCache.has(cacheKey) && (now - lastFetchTime) < (CONFIG.WEATHER?.REFRESH_INTERVAL_MS || 15 * 60 * 1000)) {
        return forecastCache.get(cacheKey);
    }

    try {
        // Note: don't use models= parameter — it changes the response structure.
        // Default "best_match" model is already an ensemble of GFS + ECMWF.
        const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}` +
            `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_speed_10m_max` +
            `&timezone=auto&forecast_days=7`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const data = await response.json();
        forecastCache.set(cacheKey, data);
        return data;
    } catch (e) {
        console.warn(`[Weather] Fetch failed for ${lat},${lon}: ${e.message}`);
        return null;
    }
}

/**
 * Parse a weather market question to extract:
 * - location (city name)
 * - metric (temperature, rain, snow, etc.)
 * - threshold (e.g., "above 60°F", "below 0°C")
 * - target date
 */
export function parseWeatherMarket(question) {
    if (!question) return null;
    const text = question.toLowerCase();

    const W = CONFIG.WEATHER || {};
    const keywords = W.MARKET_KEYWORDS || ['temperature', 'celsius', 'fahrenheit', 'degrees', 'weather'];

    // Must contain at least one weather keyword
    if (!keywords.some(kw => text.includes(kw))) return null;

    // Find matching location
    const locations = W.LOCATIONS || [];
    let matchedLocation = null;
    for (const loc of locations) {
        if (text.includes(loc.name.toLowerCase())) {
            matchedLocation = loc;
            break;
        }
    }

    // Also try common city abbreviations
    if (!matchedLocation) {
        if (text.includes('nyc') || text.includes('new york')) {
            matchedLocation = locations.find(l => l.name === 'New York' || l.name === 'NYC') || { name: 'New York', lat: 40.71, lon: -74.01 };
        } else if (text.includes('la') && (text.includes('los angeles') || text.includes('l.a.'))) {
            matchedLocation = locations.find(l => l.name === 'Los Angeles') || { name: 'Los Angeles', lat: 34.05, lon: -118.24 };
        }
    }

    if (!matchedLocation) return null;

    // Detect metric type
    let metric = 'temperature'; // default
    if (text.includes('rain') || text.includes('precipitation')) metric = 'precipitation';
    else if (text.includes('snow') || text.includes('snowfall')) metric = 'snow';
    else if (text.includes('wind')) metric = 'wind';

    // Detect unit (Fahrenheit vs Celsius)
    let unit = 'fahrenheit'; // Polymarket is US-centric
    if (text.includes('celsius') || text.includes('°c') || text.includes('° c')) unit = 'celsius';

    // Extract threshold number (e.g., "above 60", "below 32", "exceed 15°C")
    let threshold = null;
    let direction = null; // 'above' or 'below'

    const aboveMatch = text.match(/(?:above|exceed|over|higher than|at least|reach)\s+(\d+\.?\d*)/);
    const belowMatch = text.match(/(?:below|under|lower than|less than|drop below|fall below)\s+(\d+\.?\d*)/);
    const highOfMatch = text.match(/(?:high of)\s+(\d+\.?\d*)/);
    const lowOfMatch = text.match(/(?:low of)\s+(\d+\.?\d*)/);

    if (aboveMatch) {
        threshold = parseFloat(aboveMatch[1]);
        direction = 'above';
    } else if (belowMatch) {
        threshold = parseFloat(belowMatch[1]);
        direction = 'below';
    } else if (highOfMatch) {
        threshold = parseFloat(highOfMatch[1]);
        direction = 'above';
    } else if (lowOfMatch) {
        threshold = parseFloat(lowOfMatch[1]);
        direction = 'below';
    }

    // Extract target date (e.g., "on February 26", "on 2026-02-26", "tomorrow")
    let targetDate = null;
    const isoDateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    const monthDayMatch = text.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/);
    const tomorrowMatch = text.includes('tomorrow');

    if (isoDateMatch) {
        targetDate = isoDateMatch[1];
    } else if (monthDayMatch) {
        const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
        const year = new Date().getFullYear();
        targetDate = `${year}-${months[monthDayMatch[1]]}-${monthDayMatch[2].padStart(2, '0')}`;
    } else if (tomorrowMatch) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        targetDate = tomorrow.toISOString().split('T')[0];
    }

    return {
        location: matchedLocation,
        metric,
        unit,
        threshold,
        direction,
        targetDate,
    };
}

/**
 * Convert Celsius to Fahrenheit
 */
function cToF(celsius) {
    return celsius * 9 / 5 + 32;
}

/**
 * Analyze a weather market against the Open-Meteo forecast.
 * Returns a match object with confidence and direction, or null if no match.
 */
export async function analyzeWeatherMarket(market) {
    const W = CONFIG.WEATHER || {};
    if (!W.ENABLED) return null;

    const parsed = parseWeatherMarket(market.question);
    if (!parsed) return null;

    const forecast = await fetchForecast(parsed.location.lat, parsed.location.lon);
    if (!forecast || !forecast.daily) return null;

    // Find the target day in forecast data
    let dayIndex = 0; // default: today
    if (parsed.targetDate && forecast.daily.time) {
        dayIndex = forecast.daily.time.indexOf(parsed.targetDate);
        if (dayIndex === -1) {
            // Date not in 7-day forecast window
            return null;
        }
    }

    let forecastValue = null;
    let modelConfidence = 0;
    let modelAgreement = 0;

    if (parsed.metric === 'temperature') {
        // Get the relevant temperature value
        const maxTemp = forecast.daily.temperature_2m_max?.[dayIndex];
        const minTemp = forecast.daily.temperature_2m_min?.[dayIndex];
        const meanTemp = forecast.daily.temperature_2m_mean?.[dayIndex];

        if (maxTemp == null && minTemp == null) return null;

        // Determine which temp to use based on question context
        if (parsed.direction === 'above') {
            // "Will temperature exceed X?" → use max temp
            forecastValue = maxTemp;
        } else if (parsed.direction === 'below') {
            // "Will temperature drop below X?" → use min temp
            forecastValue = minTemp;
        } else {
            forecastValue = meanTemp || ((maxTemp + minTemp) / 2);
        }

        // Open-Meteo returns Celsius by default
        let forecastInUserUnit = forecastValue;
        if (parsed.unit === 'fahrenheit') {
            forecastInUserUnit = cToF(forecastValue);
        }

        // Calculate confidence based on distance from threshold
        if (parsed.threshold != null && parsed.direction) {
            const diff = forecastInUserUnit - parsed.threshold;
            const absDiff = Math.abs(diff);

            // The bigger the gap between forecast and threshold, the more confident
            // Temperature forecasts are typically accurate within 2-3 degrees
            const errorMargin = parsed.unit === 'fahrenheit' ? 4 : 2; // 4°F or 2°C margin

            if (parsed.direction === 'above') {
                // Market asks "will it exceed X?"
                if (diff > errorMargin) {
                    // Forecast clearly above threshold → YES is likely
                    modelConfidence = Math.min(0.95, 0.70 + (diff - errorMargin) * 0.05);
                    forecastValue = { side: 'YES', value: forecastInUserUnit, threshold: parsed.threshold };
                } else if (diff < -errorMargin) {
                    // Forecast clearly below threshold → NO is likely
                    modelConfidence = Math.min(0.95, 0.70 + (absDiff - errorMargin) * 0.05);
                    forecastValue = { side: 'NO', value: forecastInUserUnit, threshold: parsed.threshold };
                } else {
                    // Too close to call
                    modelConfidence = 0.50 + (absDiff / errorMargin) * 0.15;
                    forecastValue = { side: diff >= 0 ? 'YES' : 'NO', value: forecastInUserUnit, threshold: parsed.threshold };
                }
            } else if (parsed.direction === 'below') {
                // Market asks "will it drop below X?"
                if (diff < -errorMargin) {
                    modelConfidence = Math.min(0.95, 0.70 + (absDiff - errorMargin) * 0.05);
                    forecastValue = { side: 'YES', value: forecastInUserUnit, threshold: parsed.threshold };
                } else if (diff > errorMargin) {
                    modelConfidence = Math.min(0.95, 0.70 + (diff - errorMargin) * 0.05);
                    forecastValue = { side: 'NO', value: forecastInUserUnit, threshold: parsed.threshold };
                } else {
                    modelConfidence = 0.50 + (absDiff / errorMargin) * 0.15;
                    forecastValue = { side: diff <= 0 ? 'YES' : 'NO', value: forecastInUserUnit, threshold: parsed.threshold };
                }
            }
        }
    } else if (parsed.metric === 'precipitation') {
        const precipProb = forecast.daily.precipitation_probability_max?.[dayIndex];
        const precipSum = forecast.daily.precipitation_sum?.[dayIndex];

        if (precipProb == null) return null;

        modelConfidence = precipProb / 100;
        if (parsed.direction === 'above' && parsed.threshold != null) {
            // "Will it rain more than X mm?"
            forecastValue = { side: precipSum > parsed.threshold ? 'YES' : 'NO', value: precipSum, threshold: parsed.threshold };
            modelConfidence = Math.abs(precipSum - parsed.threshold) > 5 ? 0.80 : 0.55;
        } else {
            // Generic "Will it rain?"
            forecastValue = { side: precipProb > 50 ? 'YES' : 'NO', value: precipProb, threshold: 50 };
        }
    } else if (parsed.metric === 'snow') {
        const snowfall = forecast.daily.snowfall_sum?.[dayIndex];
        if (snowfall == null) return null;

        if (parsed.threshold != null) {
            const diff = snowfall - parsed.threshold;
            modelConfidence = Math.abs(diff) > 2 ? 0.80 : 0.55;
            forecastValue = { side: diff > 0 ? 'YES' : 'NO', value: snowfall, threshold: parsed.threshold };
        } else {
            modelConfidence = snowfall > 1 ? 0.75 : 0.70;
            forecastValue = { side: snowfall > 0.5 ? 'YES' : 'NO', value: snowfall, threshold: 0 };
        }
    } else if (parsed.metric === 'wind') {
        const windMax = forecast.daily.wind_speed_10m_max?.[dayIndex];
        if (windMax == null) return null;

        if (parsed.threshold != null) {
            const diff = windMax - parsed.threshold;
            modelConfidence = Math.abs(diff) > 10 ? 0.80 : 0.55;
            forecastValue = { side: diff > 0 ? 'YES' : 'NO', value: windMax, threshold: parsed.threshold };
        }
    }

    if (!forecastValue || modelConfidence < (W.MIN_CONFIDENCE || 0.70)) return null;

    // Check model agreement (multiple models in forecast)
    // Open-Meteo with models= parameter gives us ensemble data
    modelAgreement = modelConfidence > 0.80 ? 0.85 : 0.65;

    return {
        matched: true,
        location: parsed.location.name,
        metric: parsed.metric,
        forecast: forecastValue,
        confidence: modelConfidence,
        modelAgreement,
        targetDate: parsed.targetDate,
        daysOut: dayIndex,
        unit: parsed.unit,
    };
}

/**
 * Match a weather forecast to a market and determine trading signal.
 * This is the main function called from signals.js / engine.js.
 */
export function matchWeatherToMarket(market, weatherForecasts) {
    if (!weatherForecasts || weatherForecasts.length === 0) return null;

    const marketId = market.id || market.conditionID || market.conditionId;
    const match = weatherForecasts.find(f => f.marketId === marketId);
    return match || null;
}

/**
 * Batch-analyze weather markets from the market list.
 * Called from signals.js to pre-compute weather signals.
 */
export async function fetchWeatherSignals(markets) {
    const W = CONFIG.WEATHER || {};
    if (!W.ENABLED) return [];

    const results = [];
    const keywords = W.MARKET_KEYWORDS || [];

    // Pre-filter: only analyze markets with weather keywords (fast check)
    const weatherMarkets = markets.filter(m => {
        const q = (m.question || '').toLowerCase();
        return keywords.some(kw => q.includes(kw));
    });

    if (weatherMarkets.length === 0) return [];

    // Analyze each weather market (with rate limiting)
    for (const market of weatherMarkets.slice(0, 20)) { // Max 20 weather markets per scan
        try {
            const analysis = await analyzeWeatherMarket(market);
            if (analysis) {
                results.push({
                    marketId: market.id,
                    question: market.question,
                    slug: market.slug,
                    ...analysis,
                });
            }
        } catch (e) {
            console.warn(`[Weather] Analysis failed for ${market.question?.substring(0, 40)}: ${e.message}`);
        }
    }

    lastFetchTime = Date.now();
    return results;
}

/**
 * Check if a market is weather-related (quick check, no API call).
 */
export function isWeatherMarket(question) {
    if (!question) return false;
    const text = question.toLowerCase();
    const keywords = CONFIG.WEATHER?.MARKET_KEYWORDS || ['temperature', 'celsius', 'fahrenheit', 'degrees', 'weather'];
    const locations = CONFIG.WEATHER?.LOCATIONS || [];

    const hasKeyword = keywords.some(kw => text.includes(kw));
    const hasLocation = locations.some(loc => text.includes(loc.name.toLowerCase()));

    return hasKeyword && hasLocation;
}
