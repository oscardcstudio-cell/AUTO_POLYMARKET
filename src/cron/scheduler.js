
import { runBacktestSimulation } from '../logic/backtestSimulator.js';
import { strategyAdapter } from '../logic/strategyAdapter.js';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { supabase } from '../services/supabaseService.js';

// Run every 6 hours
const INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startScheduler() {
    console.log('AI Self-Training Scheduler started (Every 6h)');

    // Initial run after 30 seconds to allow server to settle and not block startup
    setTimeout(runAutoTraining, 30000);

    setInterval(runAutoTraining, INTERVAL_MS);
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

        // Walk-forward validation gate (Fix G — relaxed threshold)
        // Only reject if test set ROI is very negative AND worse than baseline test
        // Old threshold was -5% which always triggered NEUTRAL (too strict)
        const baselineTestROI = baselineTestMetrics?.roi ?? 0;
        const isOverfit = baselineTestMetrics && baselineTestROI < -10;
        if (isOverfit) {
            finalParams = { confidenceMultiplier: 1.0, sizeMultiplier: 1.0, mode: 'NEUTRAL', reason: `Test set failed validation (ROI: ${baselineTestROI.toFixed(1)}%)` };
            comparisonMsg += ` | OVERFIT DETECTED: test ROI ${baselineTestROI.toFixed(1)}% < -10%, reset to NEUTRAL`;
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
