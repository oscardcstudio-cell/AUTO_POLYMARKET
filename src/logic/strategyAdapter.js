
/**
 * strategyAdapter.js
 * Analyzes backtest results and adjusts bot parameters (Adaptive AI).
 */

export const strategyAdapter = {
    /**
     * Calculates new learning parameters based on simulation performance.
     * @param {Object} metrics - metrics object { roi, sharpeRatio, maxDrawdown } from simulation
     * @returns {Object} learningParams - { confidenceMultiplier, sizeMultiplier, mode, reason }
     */
    adapt(metrics) {
        // Default (Neutral)
        let params = {
            confidenceMultiplier: 1.0,
            sizeMultiplier: 1.0,
            mode: 'NEUTRAL',
            reason: 'Baseline performance'
        };

        if (!metrics || typeof metrics.roi !== 'number') return params;

        const roi = metrics.roi; // Percentage (e.g., 5.0 for 5%)
        const drawdown = metrics.maxDrawdown || 0; // Percentage (positive number)

        // 1. DEFENSIVE MODE (Negative Performance)
        // Soft defense: reduce by ~20% (not 37%) so bot keeps trading
        if (roi < -2.0) {
            params.mode = 'DEFENSIVE';
            params.reason = `Sim ROI negative (${roi.toFixed(2)}%)`;

            params.sizeMultiplier = 0.85;
            params.confidenceMultiplier = 0.95;

            if (drawdown > 15) {
                params.reason += ` & High Drawdown (${drawdown.toFixed(1)}%)`;
                params.sizeMultiplier = 0.65;
            }
        }
        // 2. AGGRESSIVE MODE (Strong Performance)
        else if (roi > 5.0 && drawdown < 10) {
            params.mode = 'AGGRESSIVE';
            params.reason = `Sim ROI strong (${roi.toFixed(2)}%)`;

            params.sizeMultiplier = 1.25;
            params.confidenceMultiplier = 1.05;
        }
        // 3. CONSERVATIVE MODE (Positive but risky)
        else if (roi > 0 && drawdown > 10) {
            params.mode = 'CONSERVATIVE';
            params.reason = `Profitable but high volatility`;

            params.sizeMultiplier = 0.8;
            params.confidenceMultiplier = 1.0;
        }
        // 4. NEUTRAL (Flat or minor positive)
        else {
            params.mode = 'NEUTRAL';
            params.reason = `Stable performance (${roi.toFixed(2)}%)`;
            params.sizeMultiplier = 1.0;
            params.confidenceMultiplier = 1.0;
        }

        return params;
    },

    /**
     * Compare baseline metrics vs current-params metrics (Fix F).
     * Decides whether to keep the current adapted params or reset to baseline.
     * @param {Object} baselineMetrics - metrics from neutral params run
     * @param {Object} currentMetrics - metrics from adapted params run
     * @returns {{ keepCurrent: boolean, reason: string }}
     */
    compare(baselineMetrics, currentMetrics) {
        if (!baselineMetrics || !currentMetrics) {
            return { keepCurrent: false, reason: 'Missing metrics for comparison' };
        }

        const roiDiff = currentMetrics.roi - baselineMetrics.roi;
        const drawdownDiff = currentMetrics.maxDrawdown - baselineMetrics.maxDrawdown;
        const sharpeDiff = currentMetrics.sharpeRatio - baselineMetrics.sharpeRatio;

        // Current params are better if:
        // 1. ROI is higher, AND
        // 2. Drawdown didn't increase by more than 50%
        const roiBetter = roiDiff > 0;
        const drawdownAcceptable = drawdownDiff < baselineMetrics.maxDrawdown * 0.5;

        if (roiBetter && drawdownAcceptable) {
            return {
                keepCurrent: true,
                reason: `ROI +${roiDiff.toFixed(2)}%, Drawdown ${drawdownDiff > 0 ? '+' : ''}${drawdownDiff.toFixed(1)}%, Sharpe ${sharpeDiff > 0 ? '+' : ''}${sharpeDiff.toFixed(2)}`
            };
        }

        if (roiBetter && !drawdownAcceptable) {
            return {
                keepCurrent: false,
                reason: `ROI improved +${roiDiff.toFixed(2)}% but drawdown too high (+${drawdownDiff.toFixed(1)}%)`
            };
        }

        return {
            keepCurrent: false,
            reason: `Baseline outperformed: ROI ${roiDiff.toFixed(2)}%, Sharpe ${sharpeDiff.toFixed(2)}`
        };
    },

    /**
     * Phase 6: Analyze per-strategy and per-category performance.
     * Returns overrides to disable losing strategies and boost winners.
     * @param {Object} strategyPerformance - { whale: { wins, losses, count, winRate }, ... }
     * @param {Object} categoryPerformance - { sports: { wins, losses, count, winRate }, ... }
     * @returns {Object} { disabledStrategies: [], categoryMultipliers: {}, reason: string }
     */
    adaptStrategies(strategyPerformance, categoryPerformance) {
        const overrides = {
            disabledStrategies: [],
            categoryMultipliers: {},
            reason: ''
        };

        if (!strategyPerformance && !categoryPerformance) return overrides;

        const reasons = [];

        // Disable strategies with WR < 30% and at least 5 trades
        if (strategyPerformance) {
            for (const [name, perf] of Object.entries(strategyPerformance)) {
                if (perf.count >= 5 && parseFloat(perf.winRate) < 30) {
                    overrides.disabledStrategies.push(name);
                    reasons.push(`Disabled ${name} (${perf.winRate}% WR, n=${perf.count})`);
                }
            }
        }

        // Category multipliers: scale based on WR
        if (categoryPerformance) {
            for (const [cat, perf] of Object.entries(categoryPerformance)) {
                if (perf.count < 3) continue; // Not enough data
                const wr = parseFloat(perf.winRate);
                if (wr >= 65) {
                    overrides.categoryMultipliers[cat] = 1.3; // Boost
                    reasons.push(`${cat} boosted x1.3 (${wr}% WR)`);
                } else if (wr >= 50) {
                    overrides.categoryMultipliers[cat] = 1.1;
                } else if (wr < 30) {
                    overrides.categoryMultipliers[cat] = 0.5; // Heavy penalty
                    reasons.push(`${cat} penalized x0.5 (${wr}% WR)`);
                } else if (wr < 40) {
                    overrides.categoryMultipliers[cat] = 0.7;
                    reasons.push(`${cat} penalized x0.7 (${wr}% WR)`);
                }
            }
        }

        overrides.reason = reasons.length > 0 ? reasons.join('. ') : 'No strategy overrides needed';
        return overrides;
    }
};
