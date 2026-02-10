
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { CONFIG } from './config.js';
import { supabase } from './services/supabaseService.js';

// --- LOGGING ---
export function addLog(botState, message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        message,
        type
    };
    if (!botState.logs) botState.logs = [];
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

        // 1. File Log
        const line = `[${timestamp}] [${type}] ${msg}\n`;
        const logFile = path.join(process.cwd(), 'logs.txt');
        fs.appendFileSync(logFile, line);

        // 2. Supabase Log (Async, Fire & Forget)
        if (supabase) {
            supabase.from('system_logs').insert({
                type,
                message: msg,
                item_timestamp: timestamp, // Using different name to avoid reserved word conflict if any
                metadata: {}
            }).then(({ error }) => {
                if (error) {
                    // Fail silently to avoid infinite loop of error logging
                    // process.stdout.write(`Supabase Log Error: ${error.message}\n`);
                }
            });
        }
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


