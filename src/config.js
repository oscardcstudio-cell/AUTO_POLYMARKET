
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-detect Railway Volume Path
// Note: We go up one level cause we are in src/
const ROOT_DIR = path.resolve(__dirname, '..');
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.STORAGE_PATH;
const DATA_FILE_PATH = VOLUME_PATH ? path.join(VOLUME_PATH, 'bot_data.json') : path.join(ROOT_DIR, 'bot_data.json');

export const CONFIG = {
    STARTING_CAPITAL: 1000,
    POLL_INTERVAL_MINUTES: 1,
    DEFCON_THRESHOLD: 5,
    MIN_TRADE_SIZE: 10,
    MAX_TRADE_SIZE_PERCENT: 0.10,
    MIN_LIQUIDITY: 100,
    MIN_VOLUME: 100,
    MAX_ACTIVE_TRADES: 10,
    KEYWORDS: [],
    FALLBACK_KEYWORDS: ['War', 'Strike', 'Election', 'Bitcoin', 'Economy'],
    DATA_FILE: DATA_FILE_PATH,
    PORT: process.env.PORT || 3000,
    KEYWORD_UPDATE_INTERVAL: 60 * 60 * 1000, // 1 heure
    TAKE_PROFIT_PERCENT: 0.20,
    STOP_LOSS_PERCENT: 0.15
};
