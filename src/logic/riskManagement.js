
// --- RISK MANAGEMENT MODULE ---
export const RISK_PROFILES = {
    SAFE: {
        id: 'SAFE',
        label: '🛡️ Safe',
        minConfidence: 0.75,
        maxTradeSizePercent: 0.02,
        maxActiveTrades: 5,
        allowedStrategies: ['arbitrage', 'whale_verified'],
        allowPennyStocks: false
    },
    MEDIUM: {
        id: 'MEDIUM',
        label: '⚖️ Balanced',
        minConfidence: 0.50,
        maxTradeSizePercent: 0.05,
        maxActiveTrades: 10,
        allowedStrategies: ['all_standard'],
        allowPennyStocks: false
    },
    RISKY: {
        id: 'RISKY',
        label: '🚀 Risky',
        minConfidence: 0.35,
        maxTradeSizePercent: 0.10,
        maxActiveTrades: 15,
        allowedStrategies: ['all_standard', 'contrarian', 'dip_buy'],
        allowPennyStocks: true
    },
    YOLO: {
        id: 'YOLO',
        label: '🔥 YOLO DEGEN',
        minConfidence: 0.15,
        maxTradeSizePercent: 0.20,
        maxActiveTrades: 25,
        allowedStrategies: ['anything_goes'],
        allowPennyStocks: true
    }
};

export class RiskManager {
    constructor(initialProfile = 'MEDIUM') {
        this.currentProfile = RISK_PROFILES[initialProfile] || RISK_PROFILES.MEDIUM;
    }

    setProfile(profileId) {
        if (RISK_PROFILES[profileId]) {
            this.currentProfile = RISK_PROFILES[profileId];
            return true;
        }
        return false;
    }

    getProfile() {
        return this.currentProfile;
    }

    // Calculate dynamic trade size based on profile limits
    calculateTradeSize(capital, confidence) {
        let maxPercent = this.currentProfile.maxTradeSizePercent;

        // Scale based on confidence relative to minConfidence
        // If confidence is high (e.g. 0.8) and min is 0.5, we use full maxPercent
        // If confidence is low (e.g. 0.55) and min is 0.5, we scale down slightly

        let sizePercent = maxPercent;

        // Simple linear scaling: 
        // If confidence is barely above min, use 50% of max size.
        // If confidence is +20% above min, use 100% of max size.
        const threshold = this.currentProfile.minConfidence;
        if (confidence < threshold + 0.1) {
            sizePercent = maxPercent * 0.5;
        } else if (confidence < threshold + 0.2) {
            sizePercent = maxPercent * 0.75;
        }

        let baseSize = capital * sizePercent;
        return Math.max(2, Math.floor(baseSize)); // Min $2
    }

    canTrade(strategyType, confidence, price) {
        // 1. Check Confidence
        if (confidence < this.currentProfile.minConfidence) return { allowed: false, reason: `Confidence too low (${confidence.toFixed(2)} < ${this.currentProfile.minConfidence})` };

        // 2. Check Penny Stocks
        if (price < 0.05 && !this.currentProfile.allowPennyStocks) return { allowed: false, reason: "Penny stocks not allowed in this profile" };

        // 3. Check Strategy
        if (this.currentProfile.allowedStrategies.includes('anything_goes')) return { allowed: true };
        if (this.currentProfile.allowedStrategies.includes('all_standard')) return { allowed: true }; // Assuming standard strategies

        // Specific checks for SAFE
        if (this.currentProfile.id === 'SAFE') {
            if (!this.currentProfile.allowedStrategies.includes(strategyType)) {
                return { allowed: false, reason: `Strategy '${strategyType}' not allowed in SAFE mode` };
            }
        }

        return { allowed: true };
    }
}

export const riskManager = new RiskManager();
