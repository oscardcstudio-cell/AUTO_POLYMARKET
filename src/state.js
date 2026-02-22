
import fs from 'fs';
import { CONFIG } from './config.js';
import { addLog, saveToGithub } from './utils.js';
import { supabaseService } from './services/supabaseService.js';

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
    backlog: [], // User notes, bugs, and ideas
    learningParams: {
        confidenceMultiplier: 1.0,
        sizeMultiplier: 1.0,
        mode: 'NEUTRAL',
        reason: 'Baseline'
    },
    dailyPnL: 0,
    dailyPnLResetDate: new Date().toISOString().split('T')[0],
    cooldowns: {},
    trackedWallets: [],
    lastCopySignals: []
};

export class StateManager {
    constructor(filePath = CONFIG.DATA_FILE) {
        this.filePath = filePath;
        this.data = { ...INITIAL_STATE };
        this.load();
    }

    reset() {
        console.log("☢️ NUCLEAR RESET TRIGGERED");
        // Deep copy initial state — PRESERVE REFERENCE with Object.assign
        const fresh = JSON.parse(JSON.stringify(INITIAL_STATE));
        fresh.startTime = new Date().toISOString();
        fresh.lastUpdate = new Date().toISOString();
        // Clear arrays that might have old data
        Object.keys(this.data).forEach(key => {
            if (!(key in fresh)) delete this.data[key];
        });
        Object.assign(this.data, fresh);
        this.save();
    }

    load() {
        if (fs.existsSync(this.filePath)) {
            try {
                const buffer = fs.readFileSync(this.filePath, 'utf8');
                if (buffer.trim().length > 0) {
                    const savedData = JSON.parse(buffer);
                    // Merge saved data with initial structure to ensure new fields exists
                    // PRESERVE REFERENCE by using Object.assign instead of reassignment
                    Object.assign(this.data, INITIAL_STATE, savedData);

                    // Ensure deep objects exist (merging only top level might miss nested defaults)
                    if (!this.data.apiStatus) this.data.apiStatus = { ...INITIAL_STATE.apiStatus };
                    if (!this.data.sectorActivity) this.data.sectorActivity = { ...INITIAL_STATE.sectorActivity };

                    // Sync win/loss counters from actual closed trades (prevents desync across restarts)
                    const closed = this.data.closedTrades || [];
                    const closedWithProfit = closed.filter(t => t.profit !== undefined && t.profit !== null);
                    if (closedWithProfit.length > 0) {
                        this.data.winningTrades = closedWithProfit.filter(t => t.profit > 0).length;
                        this.data.losingTrades = closedWithProfit.filter(t => t.profit <= 0).length;
                        this.data.totalTrades = closed.length + (this.data.activeTrades || []).length;
                    }

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

    save(force = false) {
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

            // --- SYNC TO SUPABASE (Throttled to every 5 min, forced on trade events) ---
            if (supabaseService) {
                // Fire and forget (don't block main loop)
                supabaseService.saveState(this.data, force).catch(err =>
                    console.error("Background Supabase Save Error:", err)
                );
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

    /**
     * Attempts to recover state from Supabase if local state seems empty, reset,
     * or desynchronized from the database (e.g. after wallet reset).
     * Should be called on server startup.
     */
    async tryRecovery() {
        // Case 1: Default state (fresh deploy or reset)
        const isDefault = this.data.totalTrades === 0 && this.data.capital === CONFIG.STARTING_CAPITAL;

        // Case 2: Check for desync — local state has active trades but DB might not
        let isDesync = false;
        const localActiveCount = this.data.activeTrades ? this.data.activeTrades.length : 0;

        if (localActiveCount > 0 && supabaseService && supabaseService.countOpenTrades) {
            try {
                const dbOpenCount = await supabaseService.countOpenTrades();
                if (dbOpenCount === 0) {
                    isDesync = true;
                    console.log(`⚠️ DESYNC DETECTED: Local has ${localActiveCount} active trades, DB has 0. Forcing recovery.`);
                    addLog(this.data, `⚠️ DESYNC: ${localActiveCount} trades locaux vs 0 en DB. Resync forcé.`, 'warning');
                }
            } catch (e) {
                console.error('Desync check failed:', e.message);
            }
        }

        if (isDefault || isDesync || !fs.existsSync(this.filePath)) {
            const reason = isDefault ? 'État local par défaut' : isDesync ? 'Désynchronisation détectée' : 'Fichier manquant';
            addLog(this.data, `⚠️ ${reason}. Tentative de récupération Cloud...`, 'warning');
            const recovered = await supabaseService.recoverState();

            if (recovered && (recovered.activeTrades.length > 0 || recovered.totalTrades > 0)) {
                // PRESERVE REFERENCE
                Object.assign(this.data, recovered);
                this.save();
                addLog(this.data, `✅ ÉTAT RESTAURÉ DEPUIS SUPABASE ! (${reason})`, 'success');
                return true;
            } else if (isDesync) {
                // DB has 0 trades but local has stale trades → full reset to initial state
                console.log('⚠️ DB empty + desync → resetting to initial state ($1000, 0 trades)');
                this.reset();
                addLog(this.data, `✅ RESET COMPLET: DB vide, état local réinitialisé à $1000`, 'success');
                return true;
            } else {
                addLog(this.data, "ℹ️ Aucune donnée trouvée sur Supabase ou échec récupération.", 'info');
            }
        }
        return false;
    }
}


export const stateManager = new StateManager();
export const botState = stateManager.data; // Export direct reference for backward compatibility in logic
