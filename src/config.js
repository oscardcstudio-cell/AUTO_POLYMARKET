
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-detect Railway Volume Path
export const ROOT_DIR = path.resolve(__dirname, '..');
// Prioritize explicit env var, then /app/data (common Railway default), then STORAGE_PATH
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    (fs.existsSync('/app/data') ? '/app/data' : null) ||
    process.env.STORAGE_PATH;

const DATA_FILE_PATH = VOLUME_PATH ? path.join(VOLUME_PATH, 'bot_data.json') : path.join(ROOT_DIR, 'bot_data.json');

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_STATIC_URL;
const ENABLE_GITHUB_SYNC = false; // Disabled by default to prevent Railway Infinite Loops

export const CONFIG = {
    ROOT_DIR,
    ENABLE_GITHUB_SYNC,
    STARTING_CAPITAL: 7000,
    POLL_INTERVAL_MINUTES: 1,
    DEFCON_THRESHOLD: 5,
    MIN_TRADE_SIZE: 10,
    MIN_PRICE_THRESHOLD: 0.05, // Filter out penny stocks (<5 cents) to avoid realistic fill issues
    MAX_TRADE_SIZE_PERCENT: 0.20, // 20% maximum of total capital per position
    KELLY_FRACTION: 0.2,          // 20% of full Kelly (conservative)
    // ── Capital Management Rules ──────────────────────────────────────────────
    CAPITAL_MANAGEMENT: {
        MAX_POSITION_PCT: 0.20,  // Rule 1: never more than 20% of total capital per position
        MAX_THEME_PCT:    0.20,  // Rule 2: never more than 20% of total capital on a single theme
        MIN_LIQUID_PCT:   0.30,  // Rule 3: always keep at least 30% of total capital in cash
    },
    MIN_LIQUIDITY: 500,
    MIN_VOLUME: 500,
    BASE_MAX_TRADES: 50,          // Max simultaneous open trades
    KEYWORDS: [],
    FALLBACK_KEYWORDS: ['War', 'Strike', 'Election', 'Bitcoin', 'Economy'],
    DATA_FILE: DATA_FILE_PATH,
    PORT: process.env.PORT || 3000,
    KEYWORD_UPDATE_INTERVAL: 60 * 60 * 1000, // 1 heure
    TAKE_PROFIT_PERCENT: 0.15,  // 15% (raised from 10% — was cutting winners too early)
    STOP_LOSS_PERCENT: 0.08,     // -8% (70% of spikes revert in 24h)
    TRADE_TIMEOUT_HOURS: 48,     // Auto-close after 48h to free capital
    DAILY_LOSS_LIMIT: 0.03,      // -3% daily halt threshold
    WEEKLY_LOSS_LIMIT: 0.07,     // -7% weekly position reduction
    DYNAMIC_SL: {
        VOLATILITY_MAP: {
            crypto: 0.20,
            economic: 0.20,
            geopolitical: 0.15,
            sports: 0.10,
            other: 0.15
        },
        // Tighter stops for speculative markets (entry price < 0.35)
        SPECULATIVE_SL_OVERRIDE: 0.20, // -20% instead of category default (widened to reduce false stop-outs)
        TRAILING_ACTIVATION: 0.10, // Activate trailing when +10% profit
        TRAILING_DISTANCE: 0.05,   // Trail by 5%
        TIME_DECAY_HOURS: 24,      // Tighten after 24h
        TIME_DECAY_PENALTY: 0.05   // Tighten by 5%
    },
    // Portfolio Hedging Limits
    PORTFOLIO_LIMITS: {
        MAX_SAME_CATEGORY: 15,     // Max trades per generic category (political, geo, etc.)
        MAX_SPORTS_CATEGORY: 20,   // Sports: best WR — allow more
        MAX_ECONOMIC_CATEGORY: 5,  // Economic: low WR — still limited
        MAX_TECH_CATEGORY: 5,      // Tech: volatile — still limited
        MAX_SAME_DIRECTION: 30,    // Max trades in same direction (YES or NO)
        CORRELATION_PENALTY: 0.10, // Confidence reduction for concentrated trades
        DIVERSITY_BONUS: 0.05      // Confidence boost for under-represented categories
    },
    // Smart Exit (Adaptive Take-Profit + Partial Exits)
    SMART_EXIT: {
        VOLATILITY_THRESHOLDS: {
            LOW: 0.02,     // stddev < 2% = low volatility
            HIGH: 0.05     // stddev > 5% = high volatility
        },
        TP_MAP: {
            LOW: 0.15,     // 15% TP for low volatility (was 8% — too early, killed gains)
            MEDIUM: 0.20,  // 20% TP for medium volatility (was 12%)
            HIGH: 0.30     // 30% TP for high volatility (was 20%)
        },
        PARTIAL_EXIT_RATIO: 0.5,     // Sell 50% on first TP hit
        EXTENDED_TP_MULTIPLIER: 2.0  // Remainder gets 2x TP target
    },
    // PizzINT Tension Thresholds (graduated geopolitical intelligence)
    TENSION: {
        // Score thresholds (0-100 composite from PizzINT multi-sensor data)
        ELEVATED: 30,       // Mild bias toward geo/eco markets
        HIGH: 55,           // Strong bias, penalize sports, reduce capacity
        CRITICAL: 80,       // Full crisis mode (replaces old binary DEFCON <= 2)

        // Alpha score modifiers by category and tension level
        GEO_BONUS_CRITICAL: 60,
        GEO_BONUS_HIGH: 40,
        GEO_BONUS_ELEVATED: 15,
        ECO_BONUS_CRITICAL: 40,
        ECO_BONUS_HIGH: 25,
        ECO_BONUS_ELEVATED: 10,
        SPORTS_PENALTY_HIGH: -30,
        SPORTS_PENALTY_CRITICAL: -50,

        // Conviction modifiers
        GEO_CONVICTION_CRITICAL: 25,
        GEO_CONVICTION_HIGH: 20,
        GEO_CONVICTION_ELEVATED: 10,

        // Fresh market bonuses
        FRESH_BONUS_CRITICAL: 30,
        FRESH_BONUS_HIGH: 20,
        FRESH_BONUS_ELEVATED: 10,

        // Portfolio capacity reduction
        CAPACITY_MULT_CRITICAL: 0.5,
        CAPACITY_MULT_HIGH: 0.75,

        // Rising tension bonus (early detection)
        RISING_TREND_BONUS: 10,
    },
    // Real News Intelligence (Google News RSS)
    NEWS: {
        CACHE_TTL_MS: 10 * 60 * 1000,  // Cache news for 10 min
        MAX_QUERIES: 6,                  // Max keyword groups to search
        REFRESH_INTERVAL_MS: 15 * 60 * 1000, // Refresh news every 15 min (not every cycle)
        // Alpha score bonuses when news matches market
        BULLISH_MATCH_BONUS: 15,        // +15 alpha if bullish news matches YES side
        BEARISH_MATCH_BONUS: 15,        // +15 alpha if bearish news matches NO side
        NEUTRAL_MATCH_BONUS: 5,         // +5 alpha for any news coverage (market is "hot")
        // Conviction bonus when news confirms trade direction
        CONVICTION_BONUS: 8,            // +8 conviction if news sentiment aligns with trade
        CONVICTION_CONFLICT_PENALTY: -5, // -5 conviction if news opposes trade
    },
    // Copy Trading (Leaderboard wallet tracking)
    COPY_TRADING: {
        ENABLED: true,
        MIN_WALLET_PNL_7D: 100,             // Only track wallets with >$100 weekly profit (lowered to fill 100 slots)
        MAX_TRACKED_WALLETS: 100,            // Track top 100 wallets
        COPY_SIZE_PERCENT: 0.023,            // Copy at 2.3% of our capital per signal (+15% raised on 2026-03-02)
        POSITION_CHECK_INTERVAL_MS: 5 * 60 * 1000,   // Check positions every 5 min
        LEADERBOARD_CACHE_TTL_MS: 6 * 60 * 60 * 1000, // Refresh leaderboard every 6h
        MIN_SOURCE_TRADE_SIZE: 300,          // Only copy trades where source invested >$300 (was $500, too selective)
        CATEGORIES: ['OVERALL'],             // Leaderboard categories to scan
        // Alpha score bonuses for copy signals
        COPY_ALPHA_BONUS: 30,                // +30 alpha if top trader is on this market
        COPY_MULTI_WALLET_BONUS: 15,         // +15 extra if 2+ tracked wallets on same market
        // Conviction bonuses
        COPY_CONVICTION_ALIGNED: 18,         // +18 conviction if copy signal aligns (was 12, 100% WR needs more trades)
        COPY_CONVICTION_STRONG: 10,          // +10 extra if source wallet in top 5 (was 8)
    },
    // Backtesting Configuration
    BACKTEST: {
        ENABLE_EXIT_SIM: true,           // Simulate SL/TP/trailing exits instead of holding to resolution
        SYNTHETIC_WALK_POINTS: 80,       // Number of synthetic price points when no CLOB history
        SYNTHETIC_VOLATILITY: {          // Per-step volatility by category (geometric Brownian motion)
            crypto: 0.03,
            economic: 0.02,
            geopolitical: 0.015,
            sports: 0.01,
            other: 0.015
        },
        TIMEOUT_STEPS: 48,              // Steps before timeout exit (~48h at 1h fidelity)
        MONTE_CARLO_PATHS: 1000,
        MONTE_CARLO_ENABLED: false,      // Off by default (enable via API param)
        SLIPPAGE_TIERS: {
            HIGH_LIQUIDITY: { minVolume: 50000, minLiquidity: 20000, slippage: 0.003 },
            MEDIUM: { minVolume: 5000, minLiquidity: 2000, slippage: 0.015 },
            LOW: { slippage: 0.03 }
        }
    },
    // Whale Tracking (Polymarket Data API — real trades)
    WHALE_TRACKING: {
        MIN_WHALE_SIZE: 500,            // Min trade size ($) to qualify as whale
        CACHE_TTL_MS: 5 * 60 * 1000,   // Cache whale data for 5 min
        REFRESH_INTERVAL_MS: 5 * 60 * 1000, // Refresh every 5 min (not every cycle)
        // Alpha score bonuses
        WHALE_ALPHA_BONUS: 20,          // +20 alpha if whale activity (was 35, caused outsized losses -$16)
        WHALE_CONSENSUS_BONUS: 10,      // +10 extra if whales agree on direction (was 15)
        // Conviction bonuses
        WHALE_CONVICTION_ALIGNED: 15,   // +15 conviction if whale direction matches trade
        WHALE_CONVICTION_OPPOSED: -10,  // -10 conviction if whales bet opposite
        WHALE_MULTI_BONUS: 10,          // +10 if multiple whales on same market
    },
    // Semantic Arbitrage (semanticArbitrage.js — cross-market inconsistency detection)
    SEMANTIC_ARB: {
        MIN_GAP_PERCENT: 8,            // Min % gap between A and B prices to flag an opportunity
        ALPHA_BONUS: 28,               // +28 alpha if semantic arb signal detected on this market
        CONVICTION_BONUS: 12,          // +12 conviction if semantic arb aligns with trade direction
        MAX_OPPORTUNITIES: 25,         // Keep top 25 opportunities per deep scan cycle
    },
    // Signal Stacking — compound bonuses when multiple independent signals align
    // "Smart money consensus": the more independent signals agree, the stronger the edge
    SIGNAL_STACKING: {
        SMART_MONEY_BONUS:     20, // Whale + Copy both on same market
        CATALYST_WIZARD_BONUS: 18, // Wizard + Event-Driven catalyst
        PANIC_CALENDAR_BONUS:  18, // Calendar Edge v2 + Panic Buy (near resolution)
        QUANT_ARB_BONUS:       14, // Semantic Arb confirmed by Quant Fair Value
        NEWS_WIZARD_BONUS:     12, // Wizard + News sentiment match
        TRIPLE_STACK_BONUS:    15, // 3+ independent signals (fallback when no specific combo)
    },
    // Behavioral Anomaly Detection (marketBehavior.js — no external API required)
    BEHAVIORAL: {
        // HYPE FADER: penalise alpha when price is high AND accelerating upward
        HYPE_PRICE_THRESHOLD: 0.62,   // Above this YES price, start checking for hype
        HYPE_MAX_PENALTY: -22,        // Max alpha penalty for overbought hype
        // PANIC BUY: reward when price drops fast near resolution
        PANIC_MAX_DAYS: 3,            // Only trigger within 3 days of resolution
        PANIC_MAX_BONUS: 28,          // Max alpha bonus for panic-sell dip
        // INTRADAY VOLATILITY bonus
        VOLATILITY_RANGE_THRESHOLD: 0.08, // Min range% to grant volatility bonus
    },
    // Calendar Edge v2 (marketBehavior.js — stagnant uncertain markets near resolution)
    CALENDAR_EDGE: {
        WINDOW_MIN_DAYS: 2,           // Don't enter if < 2 days (too close to binary)
        WINDOW_MAX_DAYS: 7,           // Don't enter if > 7 days (too early, capital stuck)
        PRICE_MIN: 0.28,              // Only target genuinely uncertain markets
        PRICE_MAX: 0.72,              // (outside this range = not interesting)
        BASE_BONUS: 16,               // Min alpha bonus at 7 days
        MAX_BONUS: 32,                // Max alpha bonus at 2 days
        CONVICTION_BONUS: 12,         // Conviction bonus in engine.js
        VOL_RATIO_THRESHOLD: 0.25,    // Volume awakening threshold
        AWAKENING_BONUS: 12,          // Max awakening bonus
    },
    // Quantitative Fair Value (computeFairValue in signals.js)
    QUANT_FAIR_VALUE: {
        MIN_EDGE: 0.04,               // Minimum 4% edge between P_bot and P_market
        MIN_SIGNALS: 2,               // At least 2 signals must agree
        MAX_ADJ: 0.22,                // Cap total probability adjustment at ±22%
        ALPHA_BUY_MULT: 300,          // edge × MULT = alpha bonus (max 30)
        ALPHA_SELL_MULT: 200,         // edge × MULT = alpha penalty (max -20)
        CONVICTION_BONUS: 4,          // Per confirming signal in engine.js
    },
    // Sports Intelligence (sportsData.js — no external API required)
    SPORTS_STRATEGY: {
        // Base home win rates by sport (historical averages, major leagues)
        // Used to detect value bets when market price diverges from base rate
        HOME_WIN_RATES: {
            soccer: 0.46,      // Premier League / La Liga / Champions League avg
            football: 0.46,    // alias
            basketball: 0.60,  // NBA average
            nba: 0.60,
            nfl: 0.57,         // NFL regular season
            baseball: 0.54,    // MLB regular season
            mlb: 0.54,
            hockey: 0.55,      // NHL regular season
            nhl: 0.55,
            tennis: 0.50,      // No home advantage
            esports: 0.50,     // No home advantage
            default: 0.53,     // Generic conservative home advantage
        },
        // Fixed alpha bonus for home advantage by sport
        // Based on home vs away win rate differential (NOT vs 50% which is misleading for soccer)
        // Soccer: home wins 46% vs away 27% → big real advantage despite 46% < 50%
        // NBA: home 60% vs away 40% → huge home advantage
        HOME_ADVANTAGE_ALPHA: {
            soccer: 9,         // Home wins 70% more often than away teams (46% vs 27%)
            football: 9,       // alias
            basketball: 15,    // NBA biggest home advantage in team sports
            nba: 15,
            nfl: 11,           // NFL: home 57% vs away 43%
            baseball: 8,       // MLB: home 54% vs away 46%
            mlb: 8,
            hockey: 10,        // NHL: home 55% vs away 45%
            nhl: 10,
            tennis: 0,         // No home advantage (neutral venues)
            esports: 0,        // No home advantage (online)
            default: 9,        // Generic conservative home advantage
        },
        // Home/Away advantage multiplier — kept for value detection only
        HOME_ADVANTAGE_MULTIPLIER: 1.5,
        // Value detection: when market price diverges from base home rate
        VALUE_EDGE_MULTIPLIER: 1.2,    // Multiply the % edge to get alpha bonus
        MAX_VALUE_BONUS: 20,           // Cap at ±20 alpha for value detection
        // Injury/suspension signals (from Google News RSS)
        INJURY_PENALTY_PER_SIGNAL: 10, // -10 alpha per negative news signal found
        MAX_INJURY_PENALTY: 25,        // Cap at -25 alpha total (injury)
        // Form/momentum signals (from Google News RSS)
        FORM_BONUS_PER_SIGNAL: 7,      // +7 alpha per positive news signal found
        MAX_FORM_BONUS: 18,            // Cap at +18 alpha total (form)
        // Motivation modifier (derby, elimination, nothing-to-play-for)
        MOTIVATION_BONUS: 8,           // ±8 alpha per motivation signal
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STRATEGY PERFORMANCE MONITORING — auto-disable/re-enable by rolling WR
    // Evaluated after every trade close + every 6h via scheduler
    // ─────────────────────────────────────────────────────────────────────────
    STRATEGY_PERFORMANCE: {
        MIN_TRADES_TO_EVALUATE: 10,  // Need ≥ 10 trades before evaluating a strategy
        ROLLING_WINDOW:         20,  // Evaluate on the last 20 trades (rolling)
        AUTO_DISABLE_WR:      0.30,  // WR < 30% on rolling window → auto-disable
        AUTO_WARN_WR:         0.40,  // WR < 40% → warning (logged, not disabled)
        AUTO_REENABLE_WR:     0.55,  // WR ≥ 55% on rolling window → re-enable
        REENABLE_MIN_TRADES:    10,  // Need ≥ 10 trades to consider re-enabling
        PROTECTED: ['standard'],     // These strategies are NEVER auto-disabled
    },

    // ─────────────────────────────────────────────────────────────────────────
    // MONTHLY DRAWDOWN PROTECTION — 3-tier automatic risk reduction
    // Resets automatically on the 1st of each month
    // ─────────────────────────────────────────────────────────────────────────
    MONTHLY_DRAWDOWN: {
        // Thresholds (% of capital at month start)
        DEFENSIVE_PCT:    0.12,  // -12% → Defensive mode
        CONSERVATION_PCT: 0.20,  // -20% → Conservation mode
        KILL_PCT:         0.25,  // -25% → Kill switch (no new trades)
        // Defensive mode restrictions
        DEFENSIVE_SIZE_MULT:      0.50,  // All positions × 0.5
        DEFENSIVE_CONVICTION_ADD: 10,    // Need 10 extra conviction pts
        // Conservation mode restrictions
        CONSERVATION_MIN_CONVICTION: 80, // Only ≥ 80pts signals
        CONSERVATION_MAX_SIZE:       50, // Max $50 per trade
        CONSERVATION_NO_SPECULATIVE: true, // No markets priced < 0.35
    },

    // ─────────────────────────────────────────────────────────────────────────
    // LIQUIDITY-ADJUSTED EDGE REQUIREMENT
    // Illiquid markets = wider spreads + harder fills → require stronger signal
    // Liquid markets = easy fills, lower edge acceptable
    // ─────────────────────────────────────────────────────────────────────────
    LIQUIDITY_EDGE: {
        VERY_LOW_LIQ:  500,    // < $500 liquidity = very illiquid
        LOW_LIQ:      2000,    // < $2k  liquidity = low
        MEDIUM_LIQ:  10000,    // < $10k liquidity = medium (> $10k = high)
        // Min conviction points required per tier
        MIN_CONVICTION_VERY_LOW: 60,   // Very illiquid: only high-conviction trades
        MIN_CONVICTION_LOW:      50,   // Low liquidity: solid signal needed
        MIN_CONVICTION_MEDIUM:   35,   // Medium: standard threshold
        MIN_CONVICTION_HIGH:     32,   // High liquidity: lower edge OK (easy fills)
    },

    // ─────────────────────────────────────────────────────────────────────────
    // VOLATILITY-ADJUSTED POSITION SIZING
    // Volatile markets = gap risk → reduce size
    // Stable markets = predictable price action → slight size increase
    // Uses detectPriceRange() intraday range from Market Memory
    // ─────────────────────────────────────────────────────────────────────────
    VOLATILITY_SIZING: {
        HIGH_RANGE:   0.20,   // Range > 20%  = HIGH volatility
        MEDIUM_RANGE: 0.10,   // Range > 10%  = MEDIUM volatility
        LOW_RANGE:    0.05,   // Range < 5%   = LOW volatility (stable)
        HIGH_MULTIPLIER:   0.65,  // Reduce position 35% on highly volatile markets
        MEDIUM_MULTIPLIER: 0.85,  // Reduce position 15% on medium volatility
        LOW_MULTIPLIER:    1.10,  // Increase position 10% on stable markets (max 10%)
    },
};
