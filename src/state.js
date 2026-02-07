
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

class StateManager {
    constructor() {
        this.data = { ...INITIAL_STATE };
        this.load();
    }

    load() {
        if (fs.existsSync(CONFIG.DATA_FILE)) {
            try {
                const buffer = fs.readFileSync(CONFIG.DATA_FILE, 'utf8');
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
                console.error("Erreur lecture données:", err);
                addLog(this.data, "Erreur lecture données, utilisation état initial", 'error');
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

            fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(this.data, null, 2));

            // Auto-backup to GitHub (every 5 saves or something? No, let's keep it simple for now)
            // In legacy code it was sometimes commented out or specific. 
            // We'll expose a method to trigger it.
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
