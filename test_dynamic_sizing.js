
import { botState } from './src/state.js';
import { CONFIG } from './src/config.js';

// Mock simple version of the logic to verify math
function calculateTradeSizeTest(confidence, price, capital) {
    if (!confidence || !price || price <= 0 || price >= 1) {
        return Math.max(CONFIG.MIN_TRADE_SIZE, Math.min(capital * 0.05, 50));
    }

    const p = confidence;
    const q = 1 - p;
    const b = (1 / price) - 1;
    let kellyFraction = (p * b - q) / b;
    const fraction = CONFIG.KELLY_FRACTION || 0.2;
    let targetPercent = kellyFraction * fraction;

    if (targetPercent < 0) targetPercent = 0.01;
    if (targetPercent > CONFIG.MAX_TRADE_SIZE_PERCENT) targetPercent = CONFIG.MAX_TRADE_SIZE_PERCENT;

    const calculatedSize = capital * targetPercent;
    return Math.max(CONFIG.MIN_TRADE_SIZE, Math.min(calculatedSize, capital * 0.15));
}

const capital = 1000;
console.log("--- KELLY DYNAMIC SIZING TEST ---");
console.log(`Capital: $${capital}`);
console.log(`Kelly Fraction: ${CONFIG.KELLY_FRACTION}`);
console.log(`Max Trade %: ${CONFIG.MAX_TRADE_SIZE_PERCENT * 100}%`);
console.log("");

const scenarios = [
    { conf: 0.60, price: 0.50, desc: "Incitation légère (Conf 60%, Prix 0.50)" },
    { conf: 0.80, price: 0.50, desc: "Forte conviction (Conf 80%, Prix 0.50)" },
    { conf: 0.90, price: 0.20, desc: "Grosse opportunité (Conf 90%, Prix 0.20)" },
    { conf: 0.45, price: 0.55, desc: "Contrarien Risqué (Conf 45%, Prix 0.55)" },
    { conf: 0.55, price: 0.50, desc: "Bruit de marché (Conf 55%, Prix 0.50)" }
];

scenarios.forEach(s => {
    const size = calculateTradeSizeTest(s.conf, s.price, capital);
    console.log(`${s.desc} => Mise: $${size.toFixed(2)}`);
});
