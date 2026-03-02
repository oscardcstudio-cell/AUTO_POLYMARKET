
import { runBacktestSimulation } from '../logic/backtestSimulator.js';
import { strategyAdapter } from '../logic/strategyAdapter.js';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { supabase } from '../services/supabaseService.js';
import { getOSINTTensionStats } from '../api/pizzint.js';
import { getOSINTNewsStats } from '../api/news.js';

// Run every 6 hours
const INTERVAL_MS     = 6 * 60 * 60 * 1000;
const WEEK_MS         = 7 * 24 * 60 * 60 * 1000;
const DAILY_MS        = 24 * 60 * 60 * 1000;

// Date du changement copy size 1.5% → 2% (pour comparer avant/après)
const COPY_SIZE_CHANGE_DATE = new Date('2026-03-02T00:00:00Z').getTime();

// Seed the initial changelog with already-made changes (first run only)
function initChangeLog() {
    if (!botState.changeLog) botState.changeLog = [];
    // Only seed if empty (first run)
    if (botState.changeLog.length > 0) return;

    botState.changeLog = [
        {
            date: '2026-03-02T00:00:00Z',
            type: 'module',
            what: '⚽ Module Sports Intelligence ajouté (7 paramètres : domicile/extérieur, blessures, forme, motivation, valeur)',
            by: 'Engue',
        },
        {
            date: '2026-03-02T00:00:00Z',
            type: 'config',
            what: '📈 COPY_SIZE_PERCENT : 1.5% → 2% (event_driven + copy ont le meilleur WR)',
            by: 'Engue',
        },
        {
            date: '2026-03-02T00:00:00Z',
            type: 'strategy',
            what: '🚫 Désactivation 3 stratégies perdantes (300 trades analysés) : whale (-$18, WR 41%), contrarian (-$9.73, WR 38%), smart_momentum (-$7.91, WR 14%)',
            by: 'Engue',
        },
    ];
    stateManager.save();
}

// Track previous state to auto-detect changes at each daily snapshot
let _prevDisabledStrategies = null;
let _prevLearningMode = null;
let _prevCopySize = null;

function runDailyReport() {
    try {
        const now    = Date.now();
        const since  = now - DAILY_MS;
        const dateLabel = new Date().toLocaleString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
        });

        // ── 1. Performance last 24h ──────────────────────────────────────────
        const closed = botState.closedTrades || [];
        const recent = closed.filter(t => {
            const ts = new Date(t.endTime || t.startTime || 0).getTime();
            return ts >= since;
        });

        const wins24h   = recent.filter(t => (t.pnl ?? 0) > 0).length;
        const losses24h = recent.filter(t => (t.pnl ?? 0) <= 0).length;
        const pnl24h    = recent.reduce((s, t) => s + (t.pnl ?? 0), 0);
        const wr24h     = recent.length > 0 ? Math.round(wins24h / recent.length * 100) : null;

        // Per-strategy breakdown (last 24h)
        const byStrategy24h = {};
        for (const t of recent) {
            const s = t.strategy || 'unknown';
            if (!byStrategy24h[s]) byStrategy24h[s] = { count: 0, pnl: 0, wins: 0 };
            byStrategy24h[s].count++;
            byStrategy24h[s].pnl += (t.pnl ?? 0);
            if ((t.pnl ?? 0) > 0) byStrategy24h[s].wins++;
        }

        // ── 2. Capital evolution ─────────────────────────────────────────────
        const capitalNow = botState.capital || 0;
        const prevReport = (botState.dailyReports || [])[0];
        const capitalDiff24h = prevReport
            ? parseFloat((capitalNow - prevReport.capitalNow).toFixed(2))
            : null;

        // ── 3. Auto-detect state changes ─────────────────────────────────────
        const overrides = botState.strategyOverrides || {};
        const currentDisabled  = JSON.stringify(overrides.disabledStrategies || []);
        const currentLearning  = botState.learningParams?.mode || 'NEUTRAL';
        const currentCopySize  = botState.config?.COPY_SIZE_PERCENT || null;

        const newChanges = [];

        if (_prevDisabledStrategies !== null && _prevDisabledStrategies !== currentDisabled) {
            newChanges.push({
                date: new Date().toISOString(),
                type: 'strategy',
                what: `🔄 Stratégies désactivées modifiées → ${currentDisabled}`,
                by: 'Auto',
            });
        }
        if (_prevLearningMode !== null && _prevLearningMode !== currentLearning) {
            newChanges.push({
                date: new Date().toISOString(),
                type: 'ai',
                what: `🤖 AI Learning mode : ${_prevLearningMode} → ${currentLearning} (${botState.learningParams?.reason || ''})`,
                by: 'Auto-Training',
            });
        }

        // Update trackers
        _prevDisabledStrategies = currentDisabled;
        _prevLearningMode       = currentLearning;
        _prevCopySize           = currentCopySize;

        // Prepend detected changes to changelog
        if (!botState.changeLog) botState.changeLog = [];
        for (const c of newChanges.reverse()) {
            botState.changeLog.unshift(c);
        }
        if (botState.changeLog.length > 40) botState.changeLog = botState.changeLog.slice(0, 40);

        // ── 4. Build and store report ────────────────────────────────────────
        const report = {
            date:           new Date().toISOString(),
            dateLabel,
            capitalNow:     parseFloat(capitalNow.toFixed(2)),
            capitalDiff24h,
            tradeCount24h:  recent.length,
            pnl24h:         parseFloat(pnl24h.toFixed(2)),
            wins24h,
            losses24h,
            wr24h,
            activeTrades:   (botState.activeTrades || []).length,
            byStrategy24h,
            disabledStrategies: [...(overrides.disabledStrategies || [])],
            learningMode:   currentLearning,
            changesDetected: newChanges.length,
        };

        if (!botState.dailyReports) botState.dailyReports = [];
        botState.dailyReports.unshift(report);
        if (botState.dailyReports.length > 7) botState.dailyReports = botState.dailyReports.slice(0, 7);
        botState.lastDailyReport = report;

        stateManager.save();

        const pnlStr = pnl24h >= 0 ? `+$${pnl24h.toFixed(2)}` : `-$${Math.abs(pnl24h).toFixed(2)}`;
        const capStr = capitalDiff24h !== null
            ? (capitalDiff24h >= 0 ? `+$${capitalDiff24h.toFixed(2)}` : `-$${Math.abs(capitalDiff24h).toFixed(2)}`)
            : 'premier snapshot';
        addLog(botState, `[Rapport 24h] ${recent.length} trades, PnL ${pnlStr}, WR ${wr24h ?? '—'}%, Capital $${capitalNow.toFixed(0)} (${capStr})`, 'info');

    } catch (e) {
        addLog(botState, `[Rapport24h] Erreur: ${e.message}`, 'error');
    }
}

export function startScheduler() {
    console.log('AI Self-Training Scheduler started (Every 6h)');

    // Seed initial changelog if not already done
    initChangeLog();

    // Initial run after 30 seconds to allow server to settle and not block startup
    setTimeout(runAutoTraining, 30000);
    setInterval(runAutoTraining, INTERVAL_MS);

    // Rapport de modif toutes les 6h (décalé de 2 min)
    setTimeout(runModifReport, 2 * 60 * 1000);
    setInterval(runModifReport, INTERVAL_MS);

    // Rapport hebdo copy/wizard — premier run dans 3 min, puis toutes les semaines
    setTimeout(runWeeklyReport, 3 * 60 * 1000);
    setInterval(runWeeklyReport, WEEK_MS);

    // Rapport 24h — premier run dans 4 min, puis toutes les 24h
    setTimeout(runDailyReport, 4 * 60 * 1000);
    setInterval(runDailyReport, DAILY_MS);
}

function computeOSINTTradeStats() {
    const closed = botState.closedTrades || [];
    const osintTrades = closed.filter(t => {
        const reasons = t.decisionReasons || t.reasons || [];
        return (
            t.category === 'geopolitical' ||
            reasons.some(r => {
                const lower = r.toLowerCase();
                return lower.includes('pizzint') || lower.includes('geopolit') || lower.includes('news');
            })
        );
    });

    const count      = osintTrades.length;
    const totalPnl   = osintTrades.reduce((sum, t) => sum + (t.profit ?? t.pnl ?? 0), 0);
    const wins       = osintTrades.filter(t => (t.profit ?? t.pnl ?? 0) > 0).length;
    const losses     = osintTrades.filter(t => (t.profit ?? t.pnl ?? 0) < 0).length;
    const winRate    = count > 0 ? Math.round((wins / count) * 100) : 0;
    const avgPnl     = count > 0 ? totalPnl / count : 0;
    const isProfit   = totalPnl > 0;

    return { count, totalPnl, wins, losses, winRate, avgPnl, isProfit };
}

function runModifReport() {
    try {
        const tension    = getOSINTTensionStats();
        const news       = getOSINTNewsStats();
        const tradeStats = computeOSINTTradeStats();
        const now        = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

        const sourcesActive = news.bySource.filter(s => s.count > 0);
        const sourcesDown   = news.bySource.filter(s => s.count === 0);
        const ageMin        = tension.lastFetch ? Math.round((Date.now() - tension.lastFetch) / 60000) : null;

        const isOk     = sourcesActive.length >= 1;
        const type     = isOk ? 'success' : 'warning';
        const cacheAge = ageMin !== null ? `(cache: ${ageMin}min)` : '';

        // Conclusion OSINT sources
        const conclusionSources = isOk
            ? `✅ CONCLUANT — ${sourcesActive.map(s => s.name).join(', ')} opérationnel(s)${sourcesDown.length > 0 ? ` | ⚠️ À relancer: ${sourcesDown.map(s => s.name).join(', ')}` : ''}`
            : `⚠️ À SURVEILLER — aucune source OSINT active, vérifier les flux RSS`;

        // Conclusion trades
        let conclusionTrades;
        if (tradeStats.count === 0) {
            conclusionTrades = `⏳ Pas encore de trades géopolitiques fermés`;
        } else if (tradeStats.isProfit) {
            conclusionTrades = `✅ PROFITABLE — +$${tradeStats.totalPnl.toFixed(2)} sur ${tradeStats.count} trades (WR: ${tradeStats.winRate}%)`;
        } else {
            conclusionTrades = `🔴 EN PERTE — $${tradeStats.totalPnl.toFixed(2)} sur ${tradeStats.count} trades (WR: ${tradeStats.winRate}%)`;
        }

        // Store structured data for the dashboard panel
        botState.lastRapportModif = {
            timestamp: Date.now(),
            date: now,
            isOk,
            tensionScore: tension.score,
            cacheAge,
            totalArticles: news.totalArticles,
            sources: news.bySource,
            conclusion: conclusionSources,
            tradeStats,
            conclusionTrades,
        };

        // Also log to Live System Logs
        addLog(botState, `━━━ 📊 RAPPORT DE MODIF — ${now} ━━━`, type);
        const sourcesLines = news.bySource.map(s =>
            s.count > 0 ? `✅ ${s.name}: ${s.count} articles` : `❌ ${s.name}: indisponible`
        ).join(' | ');
        addLog(botState, `🔍 Sources OSINT: ${sourcesLines}`, type);
        addLog(botState, `📈 Boost tension OSINT: +${tension.score}/10 ${cacheAge}`, type);
        const groupsMsg = news.totalArticles > 0
            ? `5 groupes actifs dont 1 OSINT (${news.totalArticles} articles)`
            : `4 groupes — OSINT inactif (0 article)`;
        addLog(botState, `📰 News: ${groupsMsg}`, type);
        addLog(botState, conclusionSources, type);
        addLog(botState, `💰 Trades OSINT: ${conclusionTrades}`, type);

    } catch (e) {
        addLog(botState, `[RapportModif] Erreur: ${e.message}`, 'error');
    }
}

// Stratégies ciblées pour le suivi hebdo
const TARGET_STRATEGIES = ['event_driven', 'standard', 'copy_trade', 'wizard'];

function computeTargetStrategiesStats(sinceTimestamp = 0) {
    const closed = botState.closedTrades || [];
    const byStrategy = {};

    for (const strat of TARGET_STRATEGIES) {
        byStrategy[strat] = { count: 0, totalPnl: 0, wins: 0, losses: 0 };
    }

    const trades = closed.filter(t => {
        const inPeriod = sinceTimestamp === 0 || new Date(t.endTime || t.startTime || 0).getTime() >= sinceTimestamp;
        return TARGET_STRATEGIES.includes(t.strategy) && inPeriod;
    });

    for (const t of trades) {
        const s   = t.strategy;
        const pnl = t.profit ?? t.pnl ?? 0;
        byStrategy[s].count++;
        byStrategy[s].totalPnl += pnl;
        if (pnl > 0) byStrategy[s].wins++;
        else byStrategy[s].losses++;
    }

    // Agréger toutes stratégies confondues
    const count    = trades.length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.profit ?? t.pnl ?? 0), 0);
    const wins     = trades.filter(t => (t.profit ?? t.pnl ?? 0) > 0).length;
    const losses   = trades.filter(t => (t.profit ?? t.pnl ?? 0) < 0).length;
    const winRate  = count > 0 ? Math.round((wins / count) * 100) : null;
    const avgPnl   = count > 0 ? totalPnl / count : 0;

    // Ajouter win rate par stratégie
    for (const s of TARGET_STRATEGIES) {
        const d = byStrategy[s];
        d.winRate = d.count > 0 ? Math.round((d.wins / d.count) * 100) : null;
        d.avgPnl  = d.count > 0 ? d.totalPnl / d.count : 0;
    }

    return { count, totalPnl, wins, losses, winRate, avgPnl, byStrategy };
}

function runWeeklyReport() {
    try {
        const now      = new Date();
        const nowTs    = now.getTime();
        const dateStr  = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
        const weekAgo  = nowTs - WEEK_MS;

        // Stats depuis le changement copy size (2026-03-02)
        const sinceChange = computeTargetStrategiesStats(COPY_SIZE_CHANGE_DATE);
        // Stats cette semaine seulement
        const thisWeek    = computeTargetStrategiesStats(weekAgo);
        // Stats semaine précédente (pour trend)
        const prevWeek    = computeTargetStrategiesStats(weekAgo - WEEK_MS);

        // Capital évolution
        const capitalNow = botState.capital || 0;
        const snapshots  = botState.weeklySnapshots || [];
        const lastSnap   = snapshots[snapshots.length - 1];
        const capitalDiff = lastSnap ? capitalNow - lastSnap.capital : null;

        // Sauvegarder snapshot
        if (!botState.weeklySnapshots) botState.weeklySnapshots = [];
        botState.weeklySnapshots.push({ date: dateStr, timestamp: nowTs, capital: capitalNow, stats: thisWeek });
        if (botState.weeklySnapshots.length > 8) botState.weeklySnapshots.shift();

        // Construire le rapport logs
        const lines = [];
        lines.push(`━━━ 📅 RAPPORT HEBDO — event_driven / standard / copy — ${dateStr} ━━━`);

        // Détail par stratégie depuis le 02/03
        lines.push(`📌 Depuis passage à 2% copy (02/03/2026):`);
        if (sinceChange.count === 0) {
            lines.push(`   ⏳ Pas encore de trades fermés sur ces stratégies`);
        } else {
            const sc = sinceChange;
            for (const strat of TARGET_STRATEGIES) {
                const d = sc.byStrategy[strat];
                if (d.count === 0) continue;
                const sign = d.totalPnl >= 0 ? '+' : '';
                lines.push(`   ${strat.padEnd(14)} | ${d.count} trades | WR: ${d.winRate}% | PnL: ${sign}$${d.totalPnl.toFixed(2)}`);
            }
            const sign = sc.totalPnl >= 0 ? '+' : '';
            lines.push(`   TOTAL: ${sc.count} trades | WR: ${sc.winRate}% | PnL: ${sign}$${sc.totalPnl.toFixed(2)}`);
        }

        // Cette semaine
        lines.push(`📊 Cette semaine:`);
        if (thisWeek.count === 0) {
            lines.push(`   ⏳ Aucun trade fermé sur ces stratégies cette semaine`);
        } else {
            const tw = thisWeek;
            const sign = tw.totalPnl >= 0 ? '+' : '';
            const trend = prevWeek.count > 0
                ? (tw.totalPnl > prevWeek.totalPnl ? ' 📈 progression' : ' 📉 recul')
                : '';
            lines.push(`   ${tw.count} trades | WR: ${tw.winRate}% | PnL: ${sign}$${tw.totalPnl.toFixed(2)}${trend}`);
        }

        // Capital
        if (capitalDiff !== null) {
            const sign = capitalDiff >= 0 ? '+' : '';
            lines.push(`💰 Capital: $${capitalNow.toFixed(2)} (${sign}$${capitalDiff.toFixed(2)} vs semaine dernière)`);
        } else {
            lines.push(`💰 Capital: $${capitalNow.toFixed(2)} (premier snapshot)`);
        }

        // Verdict
        const isGood = sinceChange.count > 0 && sinceChange.totalPnl > 0 && sinceChange.winRate >= 50;
        const verdict = sinceChange.count === 0
            ? `⏳ EN ATTENTE — pas encore assez de données`
            : isGood
                ? `✅ CONCLUANT — event_driven/standard/copy génèrent du profit à 2%`
                : `⚠️ À SURVEILLER — résultats insuffisants, reconsidérer le sizing`;
        lines.push(verdict);

        // Modifications faites cette semaine (depuis le changeLog)
        const changeLogWeek = (botState.changeLog || []).filter(c => {
            return new Date(c.date).getTime() >= weekAgo;
        });

        // Stocker pour le dashboard
        botState.lastWeeklyReport = {
            timestamp: nowTs,
            date: dateStr,
            sinceChange,
            thisWeek,
            capitalNow,
            capitalDiff,
            verdict,
            changeLogWeek,  // modifications made this week
        };

        // Logger dans le dashboard
        const type = isGood ? 'success' : (sinceChange.count === 0 ? 'info' : 'warning');
        for (const line of lines) addLog(botState, line, type);
        stateManager.save();

    } catch (e) {
        addLog(botState, `[RapportHebdo] Erreur: ${e.message}`, 'error');
    }
}

async function runAutoTraining() {
    console.log('Starting Automated Training Simulation...');
    addLog(botState, 'Lancement de l\'auto-entrainement IA...', 'info');

    try {
        // --- DUAL-RUN FEEDBACK LOOP (Fix F) ---
        // Run 1: Baseline (neutral params) to establish a reference
        const savedParams = botState.learningParams ? { ...botState.learningParams } : null;
        botState.learningParams = { confidenceMultiplier: 1.0, sizeMultiplier: 1.0, mode: 'NEUTRAL', reason: 'Baseline run' };

        const baselineResult = await runBacktestSimulation();
        if (baselineResult.error) {
            console.error('Auto-Training baseline error:', baselineResult.error);
            addLog(botState, `Erreur Auto-Training baseline: ${baselineResult.error}`, 'error');
            botState.learningParams = savedParams;
            return;
        }

        // Run 2: With current adapted params (if they exist)
        let currentResult = null;
        if (savedParams && savedParams.mode !== 'NEUTRAL') {
            botState.learningParams = savedParams;
            currentResult = await runBacktestSimulation();
        }

        // Compare and decide
        const baselineMetrics = baselineResult.metrics;
        const baselineTestMetrics = baselineResult.testMetrics;
        let finalParams;
        let comparisonMsg;

        if (currentResult && !currentResult.error) {
            const currentMetrics = currentResult.metrics;
            const comparison = strategyAdapter.compare(baselineMetrics, currentMetrics);

            if (comparison.keepCurrent) {
                // Current params are better, refine from current metrics
                finalParams = strategyAdapter.adapt(currentMetrics);
                comparisonMsg = `KEEP current params (${comparison.reason})`;
            } else {
                // Baseline is better, adapt from baseline
                finalParams = strategyAdapter.adapt(baselineMetrics);
                comparisonMsg = `RESET to baseline (${comparison.reason})`;
            }
        } else {
            // No previous params or error — adapt from baseline
            finalParams = strategyAdapter.adapt(baselineMetrics);
            comparisonMsg = 'First run — adapting from baseline';
        }

        // Walk-forward validation gate (Phase 8 — multi-metric overfit detection)
        const baselineTestROI = baselineTestMetrics?.roi ?? 0;
        const trainROI = baselineResult.trainMetrics?.roi ?? 0;
        const trainWR = parseFloat(baselineResult.summary?.winrate || '0');
        const trainSharpe = baselineResult.trainMetrics?.sharpeRatio ?? 0;
        const testSharpe = baselineTestMetrics?.sharpeRatio ?? 0;

        // Estimate test WR from test results
        const testTradeCount = baselineResult.testMetrics?.sampleSize || 0;
        const testWins = baselineResult.tradeResults?.slice(-(testTradeCount || 0)).filter(t => t.pnl >= 0).length || 0;
        const testWR = testTradeCount > 0 ? (testWins / testTradeCount * 100) : 0;

        const overfitReasons = [];
        if (baselineTestMetrics && baselineTestROI < -10) {
            overfitReasons.push(`ROI ${baselineTestROI.toFixed(1)}% < -10%`);
        }
        if (trainSharpe > 0 && testSharpe < trainSharpe * 0.3) {
            overfitReasons.push(`Sharpe degraded ${trainSharpe.toFixed(2)} -> ${testSharpe.toFixed(2)}`);
        }
        if (trainWR > 0 && testWR < trainWR * 0.6 && testTradeCount >= 5) {
            overfitReasons.push(`WR dropped ${trainWR.toFixed(0)}% -> ${testWR.toFixed(0)}%`);
        }

        const isOverfit = overfitReasons.length >= 2 || (overfitReasons.length === 1 && baselineTestROI < -10);
        if (isOverfit) {
            finalParams = { confidenceMultiplier: 1.0, sizeMultiplier: 1.0, mode: 'NEUTRAL', reason: `Overfit: ${overfitReasons.join(', ')}` };
            comparisonMsg += ` | OVERFIT DETECTED: ${overfitReasons.join(', ')} — reset to NEUTRAL`;
        }

        // Phase 6: Apply per-strategy overrides
        let strategyOverrides = null;
        if (baselineResult.strategyPerformance || baselineResult.categoryPerformance) {
            strategyOverrides = strategyAdapter.adaptStrategies(
                baselineResult.strategyPerformance,
                baselineResult.categoryPerformance
            );
            botState.strategyOverrides = strategyOverrides;
            if (strategyOverrides.reason && strategyOverrides.reason !== 'No strategy overrides needed') {
                comparisonMsg += ` | Strategies: ${strategyOverrides.reason}`;
            }
        }

        // Apply to bot state
        botState.learningParams = finalParams;
        stateManager.save();

        // Log
        const msg = `AI Adaptation: Mode=${finalParams.mode} | ${comparisonMsg} | Baseline ROI: ${baselineMetrics.roi.toFixed(2)}%`;
        console.log(msg);
        addLog(botState, msg, 'success');

        // Save to Supabase (matching actual table schema)
        if (supabase && baselineMetrics) {
            const { error } = await supabase.from('simulation_runs').insert({
                trade_count: baselineResult.summary.tradesCount,
                result_pnl: baselineResult.summary.totalPnL,
                result_roi: baselineMetrics.roi,
                initial_capital: baselineResult.summary.initialCapital,
                final_capital: baselineResult.summary.finalCapital,
                sharpe_ratio: baselineMetrics.sharpeRatio,
                max_drawdown: baselineMetrics.maxDrawdown,
                strategy_config: {
                    runType: 'AUTO',
                    winrate: parseFloat(baselineResult.summary.winrate),
                    marketsScanned: baselineResult.summary.tradesCount + baselineResult.summary.ignored,
                    sharpeRatio: baselineMetrics.sharpeRatio,
                    maxDrawdown: baselineMetrics.maxDrawdown,
                    avgReturnPerTrade: baselineMetrics.avgReturnPerTrade
                },
                metrics: {
                    baseline: baselineMetrics,
                    current: currentResult?.metrics || null,
                    trainMetrics: baselineResult.trainMetrics,
                    testMetrics: baselineResult.testMetrics,
                    exitStats: baselineResult.exitStats || null,
                    strategyPerformance: baselineResult.strategyPerformance || null,
                    categoryPerformance: baselineResult.categoryPerformance || null,
                    regimePerformance: baselineResult.regimePerformance || null,
                    strategyOverrides: strategyOverrides || null,
                    comparison: comparisonMsg,
                    appliedParams: finalParams,
                    sampleSize: baselineMetrics.sampleSize,
                    isReliable: baselineMetrics.isReliable
                },
                logs: baselineResult.logs
            });
            if (error) console.error('Failed to save AUTO backtest run:', error);
        }

    } catch (e) {
        console.error('Auto-Training failed:', e);
        addLog(botState, `Echec Auto-Training: ${e.message}`, 'error');
    }
}
