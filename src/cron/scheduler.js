
import { runBacktestSimulation } from '../logic/backtestSimulator.js';
import { strategyAdapter } from '../logic/strategyAdapter.js';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { supabase } from '../services/supabaseService.js';

// Run every 6 hours
const INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startScheduler() {
    console.log('🕒 AI Self-Training Scheduler started (Every 6h)');

    // Initial run after 30 seconds to allow server to settle and not block startup
    setTimeout(runAutoTraining, 30000);

    setInterval(runAutoTraining, INTERVAL_MS);
}

async function runAutoTraining() {
    console.log('🎓 Starting Automated Training Simulation...');
    addLog(botState, '🎓 Lancement de l\'auto-entraînement IA...', 'info');

    try {
        // Run with default parameters
        const result = await runBacktestSimulation();

        if (result.error) {
            console.error('Auto-Training error:', result.error);
            addLog(botState, `❌ Erreur Auto-Training: ${result.error}`, 'error');
            return;
        }

        const { metrics, summary, logs } = result;

        // Adapt Strategy
        const newParams = strategyAdapter.adapt(metrics);

        // Apply to Bot State
        botState.learningParams = newParams;
        stateManager.save(); // Persist changes

        // Log result to Console & Bot Logs
        const msg = `AI Adaptation: Mode=${newParams.mode} (ROI: ${metrics.roi.toFixed(2)}%)`;
        console.log(msg);
        addLog(botState, `🧠 ${msg}`, 'success');

        // Save run to Supabase (AUTO type)
        if (supabase && metrics) {
            const { error } = await supabase.from('simulation_runs').insert({
                run_type: 'AUTO',
                markets_tested: summary.tradesCount + summary.ignored,
                trades_count: summary.tradesCount,
                win_rate: parseFloat(summary.winrate),
                result_pnl: summary.totalPnL,
                result_roi: metrics.roi,
                initial_capital: summary.initialCapital,
                final_capital: summary.finalCapital,
                sharpe_ratio: metrics.sharpeRatio,
                max_drawdown: metrics.maxDrawdown,
                metrics: metrics,
                logs: logs // Store logs for analysis
            });
            if (error) console.error('Failed to save AUTO backtest run:', error);
        }

    } catch (e) {
        console.error('Auto-Training failed:', e);
        addLog(botState, `❌ Echec Auto-Training: ${e.message}`, 'error');
    }
}
