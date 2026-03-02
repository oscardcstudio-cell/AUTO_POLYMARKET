
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

// Date du changement copy size 1.5% → 2% (pour comparer avant/après)
const COPY_SIZE_CHANGE_DATE = new Date('2026-03-02T00:00:00Z').getTime();

export function startScheduler() {
    console.log('AI Self-Training Scheduler started (Every 6h)');

    // Initial run after 30 seconds to allow server to settle and not block startup
    setTimeout(runAutoTraining, 30000);
    setInterval(runAutoTraining, INTERVAL_MS);

    // Rapport de modif toutes les 6h (décalé de 2 min)
    setTimeout(runModifReport, 2 * 60 * 1000);
    setInterval(runModifReport, INTERVAL_MS);

    // Rapport hebdo copy/wizard — premier run dans 3 min, puis toutes les semaines
    setTimeout(runWeeklyReport, 3 * 60 * 1000);
    setInterval(runWeeklyReport, WEEK_MS);
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

function computeWizardCopyStats(sinceTimestamp = 0) {
    const closed = botState.closedTrades || [];
    const trades = closed.filter(t => {
        const reasons = t.decisionReasons || t.reasons || [];
        const isWizardCopy = t.strategy === 'wizard' ||
            reasons.some(r => r.toLowerCase().includes('wizard') || r.toLowerCase().includes('copy'));
        const inPeriod = sinceTimestamp === 0 || new Date(t.endTime || t.startTime || 0).getTime() >= sinceTimestamp;
        return isWizardCopy && inPeriod;
    });

    const count    = trades.length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.profit ?? t.pnl ?? 0), 0);
    const wins     = trades.filter(t => (t.profit ?? t.pnl ?? 0) > 0).length;
    const losses   = trades.filter(t => (t.profit ?? t.pnl ?? 0) < 0).length;
    const winRate  = count > 0 ? Math.round((wins / count) * 100) : null;
    const avgPnl   = count > 0 ? totalPnl / count : 0;
    return { count, totalPnl, wins, losses, winRate, avgPnl };
}

function runWeeklyReport() {
    try {
        const now      = new Date();
        const nowTs    = now.getTime();
        const dateStr  = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
        const weekAgo  = nowTs - WEEK_MS;

        // Stats depuis le changement copy size (2026-03-02)
        const sinceChange = computeWizardCopyStats(COPY_SIZE_CHANGE_DATE);
        // Stats cette semaine seulement
        const thisWeek    = computeWizardCopyStats(weekAgo);
        // Stats semaine précédente
        const prevWeek    = computeWizardCopyStats(weekAgo - WEEK_MS);

        // Capital évolution (capital actuel vs capital il y a 7 jours)
        const capitalNow  = botState.capital || 0;
        const snapshots   = botState.weeklySnapshots || [];

        // Évolution du capital vs snapshot semaine dernière
        const lastSnap    = snapshots[snapshots.length - 1];
        const capitalDiff = lastSnap ? capitalNow - lastSnap.capital : null;
        const capitalSign = capitalDiff >= 0 ? '+' : '';

        // Sauvegarder le snapshot de cette semaine
        const newSnap = {
            date: dateStr,
            timestamp: nowTs,
            capital: capitalNow,
            wizardStats: thisWeek,
        };
        if (!botState.weeklySnapshots) botState.weeklySnapshots = [];
        botState.weeklySnapshots.push(newSnap);
        // Garder seulement les 8 dernières semaines
        if (botState.weeklySnapshots.length > 8) botState.weeklySnapshots.shift();

        // Construire le rapport
        const lines = [];
        lines.push(`━━━ 📅 RAPPORT HEBDO COPY/WIZARD — ${dateStr} ━━━`);

        // Depuis le changement 2% (2026-03-02)
        lines.push(`📌 Depuis passage à 2% copy size (02/03/2026):`);
        if (sinceChange.count === 0) {
            lines.push(`   ⏳ Pas encore de trades wizard/copy fermés`);
        } else {
            const sc = sinceChange;
            const sign = sc.totalPnl >= 0 ? '+' : '';
            lines.push(`   ${sc.count} trades | WR: ${sc.winRate}% (${sc.wins}W/${sc.losses}L) | PnL: ${sign}$${sc.totalPnl.toFixed(2)} | moy: ${sign}$${sc.avgPnl.toFixed(2)}/trade`);
        }

        // Cette semaine vs semaine dernière
        lines.push(`📊 Cette semaine:`);
        if (thisWeek.count === 0) {
            lines.push(`   ⏳ Aucun trade wizard/copy fermé cette semaine`);
        } else {
            const tw = thisWeek;
            const sign = tw.totalPnl >= 0 ? '+' : '';
            const trend = prevWeek.count > 0
                ? (tw.totalPnl > prevWeek.totalPnl ? '📈 En progression vs semaine dernière' : '📉 En recul vs semaine dernière')
                : '';
            lines.push(`   ${tw.count} trades | WR: ${tw.winRate}% | PnL: ${sign}$${tw.totalPnl.toFixed(2)} ${trend}`);
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
                ? `✅ AJUSTEMENT CONCLUANT — copy 2% génère du profit`
                : `⚠️ À SURVEILLER — résultats insuffisants, reconsidérer`;
        lines.push(verdict);

        // Stocker pour le dashboard
        botState.lastWeeklyReport = {
            timestamp: nowTs,
            date: dateStr,
            sinceChange,
            thisWeek,
            capitalNow,
            capitalDiff,
            verdict,
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
