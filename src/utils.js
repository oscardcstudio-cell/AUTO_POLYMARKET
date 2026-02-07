
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
    // Only verify if git is configured, otherwise skip silently to avoid spam
    // In a real/production env, we might want to use a specific Git library
    // For now, consistent with legacy behavior:
    const gitDir = path.join(path.dirname(CONFIG.DATA_FILE), '.git');
    if (!fs.existsSync(gitDir)) return;

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
