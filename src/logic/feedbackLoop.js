import { supabase } from '../services/supabaseService.js';
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { exec } from 'child_process';
import path from 'path';

export const feedbackLoop = {
    /**
     * Analyzes historical performance by category and updates botState.confidenceAdjustments
     */
    async analyzePerformance() {
        if (!supabase) return;

        try {
            // Fetch category performance view
            const { data, error } = await supabase
                .from('view_category_performance')
                .select('*');

            if (error) throw error;
            if (!data || data.length === 0) return;

            const adjustments = {};
            let logMessage = "🧠 AI Feedback Analysis:\n";

            data.forEach(cat => {
                // Minimum sample size
                if (cat.trade_count < 5) return;

                const roi = cat.avg_roi_percent; // e.g. -15.5 or 22.0
                let adj = 0;

                // Penalty for bad performance
                if (roi < -20) adj = -0.15;
                else if (roi < -10) adj = -0.10;
                else if (roi < -5) adj = -0.05;

                // Boost for good performance
                if (roi > 20) adj = 0.10;
                else if (roi > 10) adj = 0.05;

                if (adj !== 0) {
                    adjustments[cat.category] = adj;
                    const emoji = adj > 0 ? "📈" : "📉";
                    logMessage += `${emoji} ${cat.category}: ROI ${roi.toFixed(1)}% -> Adj: ${adj > 0 ? '+' : ''}${adj.toFixed(2)}\n`;
                }
            });

            // Update State
            botState.confidenceAdjustments = adjustments;
            stateManager.save();

            if (Object.keys(adjustments).length > 0) {
                console.log(logMessage);
                addLog(botState, "🧠 AI Feedback: Confidence adjustments updated based on performance.", 'info');
            }

        } catch (err) {
            console.error('Error in feedbackLoop:', err.message);
        }
    }
    ,

    /**
     * Autonomous Backtest Strategy
     * Runs a backtest if enough time has passed or if significant learning occurred.
     */
    async runAutonomousBacktest() {
        const NOW = Date.now();
        const LAST_RUN = botState.lastBacktestRequest || 0;
        const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

        // Strategy: Run if interval passed OR if confidence adjustments explicitly requested it (flag)
        if (NOW - LAST_RUN > INTERVAL_MS) {
            console.log('🧪 Starting Autonomous Backtest...');
            addLog(botState, '🧪 Lancement du Backtest Autonome (Vérification Stratégie)...', 'info');

            botState.lastBacktestRequest = NOW; // Update immediately to prevent double-fire
            stateManager.save();

            const scriptPath = path.join(process.cwd(), 'scripts', 'backtest_public.js');

            exec(`node ${scriptPath}`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Auto-Backtest Error: ${error.message}`);
                    addLog(botState, `❌ Auto-Backtest Failed: ${error.message}`, 'error');
                    return;
                }

                // Parse Check: Look for "ROI:" in output
                if (stdout.includes("ROI:")) {
                    // Extract rough ROI for log
                    const roiMatch = stdout.match(/ROI:\s*([+\-]?\d+\.?\d*)/);
                    const roi = roiMatch ? roiMatch[1] : "?";
                    addLog(botState, `✅ Auto-Backtest Terminé. ROI Actuel: ${roi}%`, 'success');
                } else {
                    addLog(botState, `✅ Auto-Backtest Terminé (voir Dashboard)`, 'success');
                }
            });
        }
    }
};
