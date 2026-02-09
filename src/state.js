
import fs from 'fs';
import { CONFIG } from './config.js';
import { addLog, saveToGithub } from './utils.js';

// Initial State Template
const INITIAL_STATE = {
    startTime: new Date().toISOString(),
    capital: CONFIG.STARTING_CAPITAL,
    startingCapital: CONFIG.STARTING_CAPITAL,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    activeTrades: [],
    closedTrades: [],
    capitalHistory: [],
    lastPizzaData: null,
    topSignal: null,
    lastUpdate: new Date().toISOString(),
    logs: [],
    whaleAlerts: [],
    arbitrageOpportunities: [],
    newsSentiment: [],
    momentumData: {},
    apiStatus: {
        gamma: 'Checking...',
        clob: 'Checking...',
        pizzint: 'Checking...',
        alpha: 'Checking...'
    },
    wizards: [],
    freshMarkets: [],
    keywordScores: {},
    deepScanData: {
        lastScan: null,
        marketCount: 0,
        scanDuration: 0
    },
    clobSpreadWarnings: [],
    sectorStats: {},
    sectorActivity: {
        politics: [],
        economics: [],
        tech: [],
        trending: []
    },
    backlog: [] // User notes, bugs, and ideas
};

export class StateManager {
    constructor(filePath = CONFIG.DATA_FILE) {
        this.filePath = filePath;
        this.data = { ...INITIAL_STATE };
        this.load();
    }

    load() {
        if (fs.existsSync(this.filePath)) {
            try {
                const buffer = fs.readFileSync(this.filePath, 'utf8');
                if (buffer.trim().length > 0) {
                    const savedData = JSON.parse(buffer);
                    // Merge saved data with initial structure to ensure new fields exists
                    this.data = { ...INITIAL_STATE, ...savedData };
                    // Ensure deep objects exist (merging only top level might miss nested defaults)
                    if (!this.data.apiStatus) this.data.apiStatus = { ...INITIAL_STATE.apiStatus };
                    if (!this.data.sectorActivity) this.data.sectorActivity = { ...INITIAL_STATE.sectorActivity };

                    addLog(this.data, `Chargement des données réussi ($${this.data.capital.toFixed(2)})`, 'success');
                }
            } catch (err) {
                console.error("Erreur lecture données state:", err.message);

                // Corruption Handling: Backup & Reset
                if (err instanceof SyntaxError) {
                    const backupPath = this.filePath + '.bak';
                    console.warn(`⚠️ CORRUPTION DÉTECTÉE: Sauvegarde de l'état corrompu vers ${backupPath}`);
                    try {
                        fs.copyFileSync(this.filePath, backupPath);
                    } catch (backupErr) {
                        console.error("Échec de la backup du fichier corrompu:", backupErr);
                    }
                }

                addLog(this.data, "Erreur lecture données, réinitialisation (backup créée)", 'error');
                // this.data is already INITIAL_STATE
            }
        } else {
            addLog(this.data, "Aucun fichier de données, création d'un nouveau profil", 'warning');
            this.save();
        }
    }

    save() {
        try {
            // Update derived stats before saving
            this.data.lastUpdate = new Date().toISOString();
            this.data.profit = this.data.capital - this.data.startingCapital;
            this.data.profitPercent = ((this.data.profit) / this.data.startingCapital * 100).toFixed(2);

            // --- RECALCULATE SECTOR STATS (Fix for BUG-002) ---
            // Initialize if missing
            if (!this.data.sectorStats) this.data.sectorStats = { politics: { count: 0 }, economics: { count: 0 }, tech: { count: 0 }, trending: { count: 0 } };

            const sectors = ['politics', 'economics', 'tech', 'trending'];
            sectors.forEach(s => {
                // Count active trades in this sector
                const tradeCount = this.data.activeTrades.filter(t => {
                    const cat = (t.category || '').toLowerCase();
                    if (s === 'politics' && cat.includes('politi')) return true;
                    if (s === 'economics' && cat.includes('eco')) return true;
                    if (s === 'tech' && (cat.includes('tech') || cat.includes('ai'))) return true;
                    if (s === 'trending' && !cat.includes('politi') && !cat.includes('eco') && !cat.includes('tech')) return true;
                    return false;
                }).length;

                // Count recent activity events
                const activityCount = (this.data.sectorActivity && this.data.sectorActivity[s]) ? this.data.sectorActivity[s].length : 0;

                this.data.sectorStats[s] = {
                    count: tradeCount + activityCount, // Active items = trades + recent alerts
                    lastActivity: new Date().toISOString()
                };
            });



            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));

            // Sync to GitHub to allow AI/Antigravity to see updates
            if (CONFIG.ENABLE_GITHUB_SYNC) {
                saveToGithub("Update bot state & backlog");
            }
        } catch (error) {
            console.error('❌ Erreur sauvegarde:', error.message);
        }
    }

    // Helper to log sector events
    addSectorEvent(category, type, message, data = null) {
        let key = 'trending';
        if (category) {
            const c = typeof category === 'string' ? category.toLowerCase() : '';
            if (c.includes('politi')) key = 'politics';
            else if (c.includes('eco')) key = 'economics';
            else if (c.includes('tech') || c.includes('ai')) key = 'tech';
        }

        if (!this.data.sectorActivity) this.data.sectorActivity = { politics: [], economics: [], tech: [], trending: [] };
        if (!this.data.sectorActivity[key]) this.data.sectorActivity[key] = [];

        const event = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: new Date().toISOString(),
            type,
            message,
            data
        };

        this.data.sectorActivity[key].unshift(event);
        if (this.data.sectorActivity[key].length > 10) this.data.sectorActivity[key].pop();
    }
}

export const stateManager = new StateManager();
export const botState = stateManager.data; // Export direct reference for backward compatibility in logic
