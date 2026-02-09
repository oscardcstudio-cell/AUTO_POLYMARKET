
import { supabaseService, supabase } from '../src/services/supabaseService.js';
import { botState } from '../src/state.js';

async function trainOnHistory() {
    console.log('🦾 Starting AI Training Simulation...');

    // 1. Fetch History
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*');
    // .eq('status', 'CLOSED'); // For now, use all including open for simulation if needed, but closed is better for PnL

    if (error) {
        console.error('❌ Error fetching history:', error);
        process.exit(1);
    }

    console.log(`📚 Loaded ${trades.length} historical trades.`);

    // 2. Define Hyperparameters to Test
    const confidenceThresholds = [0.4, 0.5, 0.6, 0.7, 0.8];
    const results = [];

    // 3. Run Simulation
    for (const threshold of confidenceThresholds) {
        let simulatedPnL = 0;
        let tradeCount = 0;
        let winCount = 0;

        for (const trade of trades) {
            // Apply Strategy Filter: Would we have taken this trade with the new threshold?
            // We use the recorded 'confidence' at entry.
            if (trade.confidence >= threshold) {
                // Determine outcome (Mock outcome for OPEN trades or use Real PnL for CLOSED)
                let pnl = 0;
                if (trade.status === 'CLOSED' && trade.exitPrice) {
                    pnl = (trade.exitPrice - trade.entryPrice) * trade.shares;
                } else {
                    // Start of simulation: assume OPEN trades are flat or use current price if available
                    // For backtesting, we ideally need CLOSED trades. SImulating 0 PnL for open.
                    pnl = 0;
                }

                simulatedPnL += pnl;
                tradeCount++;
                if (pnl > 0) winCount++;
            }
        }

        const winRate = tradeCount > 0 ? (winCount / tradeCount * 100).toFixed(1) : 0;
        results.push({
            threshold,
            pnl: simulatedPnL.toFixed(2),
            trades: tradeCount,
            winRate: winRate + '%'
        });
    }

    // 4. Output Results
    console.table(results);

    // 5. Find Best Strategy
    const best = results.reduce((prev, current) => (parseFloat(current.pnl) > parseFloat(prev.pnl) ? current : prev));
    console.log(`\n🏆 OPTIMAL STRATEGY: Confidence Threshold > ${best.threshold}`);
    console.log(`💰 Projected PnL: $${best.pnl} (${best.trades} trades)`);

    process.exit(0);
}

trainOnHistory();
