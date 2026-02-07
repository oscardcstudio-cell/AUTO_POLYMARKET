
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { CONFIG } from './config.js';

// --- LOGGING ---
export function addLog(botState, message, type = 'info') {
    const logEntry = {
        timestamp: new Date().toISOString(),
        message,
        type
    };
    if (!botState.logs) botState.logs = [];
    botState.logs.unshift(logEntry);
    if (botState.logs.length > 200) botState.logs.pop();

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
    exec(`git add "${CONFIG.DATA_FILE}" && git commit -m "${commitMessage}" && git push`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Git Save Error: ${error.message}`);
            return;
        }
        if (stdout) console.log(`Git Output: ${stdout.trim()}`);
    });
}
