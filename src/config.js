
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
    STARTING_CAPITAL: 1000,
    POLL_INTERVAL_MINUTES: 1,
    DEFCON_THRESHOLD: 5,
    MIN_TRADE_SIZE: 10,
    MIN_PRICE_THRESHOLD: 0.05, // Filter out penny stocks (<5 cents) to avoid realistic fill issues
    MAX_TRADE_SIZE_PERCENT: 0.05, // 5% maximum of total capital (research-backed)
    KELLY_FRACTION: 0.2,          // 20% of full Kelly (conservative)
    MIN_LIQUIDITY: 500,
    MIN_VOLUME: 500,
    BASE_MAX_TRADES: 10,          // Starting limit for diversification
    KEYWORDS: [],
    FALLBACK_KEYWORDS: ['War', 'Strike', 'Election', 'Bitcoin', 'Economy'],
    DATA_FILE: DATA_FILE_PATH,
    PORT: process.env.PORT || 3000,
    KEYWORD_UPDATE_INTERVAL: 60 * 60 * 1000, // 1 heure
    TAKE_PROFIT_PERCENT: 0.10,  // 10% (research-backed for prediction markets)
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
        TRAILING_ACTIVATION: 0.10, // Activate trailing when +10% profit
        TRAILING_DISTANCE: 0.05,   // Trail by 5%
        TIME_DECAY_HOURS: 24,      // Tighten after 24h
        TIME_DECAY_PENALTY: 0.05   // Tighten by 5%
    },
    // Portfolio Hedging Limits
    PORTFOLIO_LIMITS: {
        MAX_SAME_CATEGORY: 3,      // Max trades in same category (e.g., 3 political)
        MAX_SAME_DIRECTION: 6,     // Max trades in same direction (e.g., 6 YES)
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
            LOW: 0.08,     // 8% TP for low volatility markets
            MEDIUM: 0.12,  // 12% TP for medium volatility
            HIGH: 0.20     // 20% TP for high volatility
        },
        PARTIAL_EXIT_RATIO: 0.5,     // Sell 50% on first TP hit
        EXTENDED_TP_MULTIPLIER: 2.0  // Remainder gets 2x TP target
    }
};
