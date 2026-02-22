
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { CONFIG } from './config.js';
// --- LOGGING ---
export function addLog(botState, message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        message,
        type
    };
    if (!Array.isArray(botState.logs)) botState.logs = [];
    botState.logs.unshift(logEntry);
    if (botState.logs.length > 1000) botState.logs.pop();

    // Console output with colors
    const colors = {
        info: '\x1b[36m%s\x1b[0m', // Cyan
        success: '\x1b[32m%s\x1b[0m', // Green
        warning: '\x1b[33m%s\x1b[0m', // Yellow
        error: '\x1b[31m%s\x1b[0m', // Red
        trade: '\x1b[35m%s\x1b[0m' // Magenta
    };
    const color = colors[type] || colors.info;
    console.log(color, `[${type.toUpperCase()}] ${message}`);

    // --- PERSISTENT FILE LOGGING (Self-Governance) ---
    try {
        const logLine = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
        const logFile = path.join(process.cwd(), 'logs.txt');
        fs.appendFileSync(logFile, logLine);
    } catch (e) {
        console.error("Failed to write to logs.txt:", e);
    }
}

// --- NETWORK ---
export async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeout = 20000;

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

            // Don't retry on 401/403 (Auth failure)
            if (error.message.includes('401') || error.message.includes('403')) {
                throw error;
            }

            // Exponential backoff
            const delay = Math.pow(2, attempt - 1) * 1000;
            // Use console.log directly here to avoid circular dependency if we used addLog (which might use supabase which might use fetch...)
            // But addLog is safe as it uses fs. So we can use it if we had the state, but this is a util.
            console.log(`⚠️ Network error: ${error.message}. Retrying in ${delay}ms... (Attempt ${attempt}/${retries})`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// --- GITHUB SYNC ---
export function saveToGithub(commitMessage = "Auto-save bot state") {
    // 1. Check if sync is enabled in config (disables local sync)
    if (!CONFIG.ENABLE_GITHUB_SYNC) return;

    // 2. Only verify if git is configured (look in root, not just data dir)
    const rootGitDir = path.join(CONFIG.ROOT_DIR, '.git');
    if (!fs.existsSync(rootGitDir)) return;

    // Note: This function previously used execSync which is blocking.
    // Using exec (async) is safer for the event loop.
    // Add bot_data.json AND trade_decisions.jsonl
    exec(`git add "bot_data.json" "trade_decisions.jsonl" && git commit -m "${commitMessage}" && git push`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Git Save Error: ${error.message}`);
            return;
        }
        if (stdout) console.log(`Git Output: ${stdout.trim()}`);
    });
}
// --- SYSTEM LOG OVERRIDE (Capture everything for /logs endpoint) ---
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function appendToSystemLog(type, args) {
    try {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        const timestamp = new Date().toISOString();

        // File Log only (Supabase system_logs removed — was causing 10k-40k writes/day, maxing CPU)
        const line = `[${timestamp}] [${type}] ${msg}\n`;
        const logFile = path.join(process.cwd(), 'logs.txt');
        fs.appendFileSync(logFile, line);
    } catch (e) {
        // Ignored to prevent loop
    }
}

console.log = function (...args) {
    originalConsoleLog.apply(console, args);
    appendToSystemLog('INFO', args);
};

console.error = function (...args) {
    originalConsoleError.apply(console, args);
    appendToSystemLog('ERROR', args);
};


