
import express from 'express';
import { runBacktestSimulation } from '../logic/backtestSimulator.js';
import { supabase } from '../services/supabaseService.js';

const router = express.Router();

/**
 * POST /api/run-backtest
 * Runs a realistic backtest using real resolved Polymarket markets.
 */
router.post('/run-backtest', async (req, res) => {
    try {
        const result = await runBacktestSimulation();

        if (result.error) {
            return res.json({ success: false, error: result.error, output: result.logs.join('\n') });
        }

        const { metrics, summary, logs, tradeResults, trainMetrics, testMetrics } = result;

        // Log results to Supabase asynchronously
        if (supabase && metrics) {
            supabase.from('simulation_runs').insert({
                run_type: 'MANUAL',
                markets_tested: summary.tradesCount + summary.ignored,
                trades_count: summary.tradesCount,
                win_rate: parseFloat(summary.winrate),
                result_pnl: summary.totalPnL,
                result_roi: metrics.roi,
                initial_capital: summary.initialCapital,
                final_capital: summary.finalCapital,
                sharpe_ratio: metrics.sharpeRatio,
                max_drawdown: metrics.maxDrawdown,
                metrics: {
                    combined: metrics,
                    trainMetrics: trainMetrics || null,
                    testMetrics: testMetrics || null,
                    sampleSize: metrics.sampleSize,
                    isReliable: metrics.isReliable
                },
                logs: logs
            }).then(({ error }) => {
                if (error) console.error('Failed to save manual backtest run:', error);
            });
        }

        res.json({
            success: true,
            trades: summary.tradesCount,
            roi: metrics ? metrics.roi.toFixed(2) + '%' : '0%',
            winrate: summary.winrate + '%',
            pnl: summary.totalPnL.toFixed(2),
            output: logs.join('\n')
        });

    } catch (error) {
        console.error('Backtest route error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/backtest-results
// Fetches past simulation runs (both MANUAL and AUTO)
router.get('/backtest-results', async (req, res) => {
    if (!supabase) return res.json({ runs: [] });

    const { data, error } = await supabase
        .from('simulation_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json({ runs: data });
});

export default router;
