
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

        if (!metrics) return params;

        const roi = metrics.roi; // Percentage (e.g., 5.0 for 5%)
        const drawdown = metrics.maxDrawdown; // Percentage (positive number)

        // 1. DEFENSIVE MODE (Negative Performance)
        if (roi < -2.0) {
            params.mode = 'DEFENSIVE';
            params.reason = `Sim ROI negative (${roi.toFixed(2)}%)`;

            // reduce sizing significantly
            params.sizeMultiplier = 0.7;
            // increase confidence threshold (require higher confidence to trade)
            // Implementation note: we MULTIPLY the threshold by this? No, usually we multiply the *score*.
            // If we multiply the required threshold by 1.1, it's harder to trade.
            // If we multiply the score by 0.9, it's harder to trade.
            // Let's assume we multiply the SCORE.
            params.confidenceMultiplier = 0.9;

            if (drawdown > 15) {
                params.reason += ` & High Drawdown (${drawdown.toFixed(1)}%)`;
                params.sizeMultiplier = 0.5; // Very defensive
            }
        }
        // 2. AGGRESSIVE MODE (Strong Performance)
        else if (roi > 5.0 && drawdown < 10) {
            params.mode = 'AGGRESSIVE';
            params.reason = `Sim ROI strong (${roi.toFixed(2)}%)`;

            params.sizeMultiplier = 1.25; // Increase sizing
            params.confidenceMultiplier = 1.05; // Boost confidence score slightly
        }
        // 3. CONSERVATIVE MODE (Positive but risky)
        else if (roi > 0 && drawdown > 10) {
            params.mode = 'CONSERVATIVE';
            params.reason = `Profitable but high volatility`;

            params.sizeMultiplier = 0.8; // Reduce size to manage risk
            params.confidenceMultiplier = 1.0; // Keep confidence normal
        }
        // 4. NEUTRAL (Flat or minor positive)
        else {
            params.mode = 'NEUTRAL';
            params.reason = `Stable performance (${roi.toFixed(2)}%)`;
            params.sizeMultiplier = 1.0;
            params.confidenceMultiplier = 1.0;
        }

        return params;
    }
};
