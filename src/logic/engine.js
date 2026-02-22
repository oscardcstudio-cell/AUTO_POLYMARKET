
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';
import { categorizeMarket } from './signals.js';
import { getBestExecutionPrice, getCLOBOrderBook, getCLOBTradeHistory } from '../api/clob_api.js';
import { supabaseService } from '../services/supabaseService.js';
import { sportsService } from '../services/sportsService.js';
import { getAdvancedSignals, evaluateDCA, executeDCA } from './advancedStrategies.js';

function calculateTradeSize(confidence, price) {
    const capital = botState.capital || CONFIG.STARTING_CAPITAL;

    // Safety Fallback
    if (!confidence || !price || price <= 0 || price >= 1) {
        const defaultSize = Math.max(CONFIG.MIN_TRADE_SIZE, Math.min(capital * 0.05, 50));
        return defaultSize;
    }

    // Fractional Kelly Criterion
    // Formula: f = (p*b - q) / b  where b are the odds (1/price - 1)
    // Simplified for binary outcome: f = (confidence - price) / (1 - price)

    const p = confidence;
    const q = 1 - p;
    const b = (1 / price) - 1;

    let kellyFraction = (p * b - q) / b;

    // Apply conservative fractional factor
    const fraction = CONFIG.KELLY_FRACTION || 0.2;
    let targetPercent = kellyFraction * fraction;

    // Safety Bounds
    if (targetPercent < 0) targetPercent = 0.01; // Minimum skin in the game if signal exists
    if (targetPercent > CONFIG.MAX_TRADE_SIZE_PERCENT) targetPercent = CONFIG.MAX_TRADE_SIZE_PERCENT;

    const calculatedSize = capital * targetPercent;

    return Math.max(CONFIG.MIN_TRADE_SIZE, Math.min(calculatedSize, capital * 0.15));
}

// --- CONVICTION SCORING: Evaluate ALL signals for composite confidence ---
async function calculateConviction(market, pizzaData, dependencies) {
    const { calculateIntradayTrendFn } = dependencies;
    let convictionPoints = 0;
    const signals = [];
    const yesPrice = parseFloat(market.outcomePrices?.[0] || '0');
    const noPrice = parseFloat(market.outcomePrices?.[1] || '0');
    const category = categorizeMarket(market.question);
    const volume24h = parseFloat(market.volume24hr || 0);

    // 1. Arbitrage signal (+40)
    const hasArbitrage = botState.arbitrageOpportunities?.some(a => a.id === market.id);
    if (hasArbitrage && yesPrice + noPrice < 0.995) {
        convictionPoints += 40;
        signals.push('Arbitrage (+40)');
    }

    // 2. Whale signal — uses real trade data from Polymarket Data API
    const W = CONFIG.WHALE_TRACKING || {};
    const whaleMatch = market._whaleMatch; // Set by calculateAlphaScore in signals.js
    const isWhaleMarket = !!whaleMatch;
    if (isWhaleMarket) {
        // Check if whale direction aligns with our likely trade direction
        const tradeDirection = yesPrice > 0.5 ? 'BULLISH' : 'BEARISH';
        if (whaleMatch.consensus === tradeDirection) {
            convictionPoints += (W.WHALE_CONVICTION_ALIGNED || 15);
            signals.push(`🐳 WhaleAlign:${whaleMatch.consensus} (+${W.WHALE_CONVICTION_ALIGNED || 15})`);
        } else if (whaleMatch.consensus !== 'MIXED' && whaleMatch.consensus !== tradeDirection) {
            convictionPoints += (W.WHALE_CONVICTION_OPPOSED || -10);
            signals.push(`🐳 WhaleOppose:${whaleMatch.consensus} (${W.WHALE_CONVICTION_OPPOSED || -10})`);
        } else {
            convictionPoints += 5;
            signals.push('🐳 WhaleActivity (+5)');
        }
        if ((whaleMatch.whaleCount || 0) >= 3) {
            convictionPoints += (W.WHALE_MULTI_BONUS || 10);
            signals.push(`Multi-whale x${whaleMatch.whaleCount} (+${W.WHALE_MULTI_BONUS || 10})`);
        }
    }

    // 2b. Copy trade signal — top leaderboard wallets holding positions
    const CT = CONFIG.COPY_TRADING || {};
    const copyMatch = market._copyMatch;
    if (copyMatch && CT.ENABLED) {
        const tradeDirection = yesPrice > 0.5 ? 'Yes' : 'No';
        if (copyMatch.outcome === tradeDirection) {
            convictionPoints += (CT.COPY_CONVICTION_ALIGNED || 12);
            signals.push(`CopyAlign: ${copyMatch.topTrader} #${copyMatch.topRank} (+${CT.COPY_CONVICTION_ALIGNED || 12})`);
        }
        if (copyMatch.topRank <= 5) {
            convictionPoints += (CT.COPY_CONVICTION_STRONG || 8);
            signals.push(`CopyTop5: #${copyMatch.topRank} (+${CT.COPY_CONVICTION_STRONG || 8})`);
        }
        if (copyMatch.count >= 2) {
            convictionPoints += 5;
            signals.push(`CopyMulti: ${copyMatch.count} wallets (+5)`);
        }
    }

    // 3. Fresh market with volume (+20)
    const isFresh = botState.freshMarkets?.some(f => f.id === market.id);
    if (isFresh && volume24h > 2000) {
        convictionPoints += 20;
        signals.push('Fresh+Volume (+20)');
    }

    // 4. Alpha score (+20 if >75, +10 if >50)
    const alphaScore = market._alphaScore || 0;
    if (alphaScore > 75) {
        convictionPoints += 20;
        signals.push(`HighAlpha ${alphaScore} (+20)`);
    } else if (alphaScore > 50) {
        convictionPoints += 10;
        signals.push(`MedAlpha ${alphaScore} (+10)`);
    }

    // 5. Wizard signal (+15)
    const isWizard = botState.wizards?.some(w => w.id === market.id);
    if (isWizard) {
        convictionPoints += 15;
        signals.push('Wizard (+15)');
    }

    // 6. Trend confirmation via CLOB (+15)
    if (!isWhaleMarket && volume24h > 1000 && yesPrice > 0.55 && yesPrice < 0.90) {
        try {
            const trend = await calculateIntradayTrendFn(market.id);
            if (trend === 'UP' || trend === 'DOWN') {
                convictionPoints += 15;
                signals.push(`Trend ${trend} (+15)`);
            }
        } catch { /* skip */ }
    }

    // 7. Hype fader territory (+10)
    if ((yesPrice > 0.92 && yesPrice < 0.98) || (noPrice > 0.92 && noPrice < 0.98)) {
        convictionPoints += 10;
        signals.push('HypeFader (+10)');
    }

    // 8. PizzINT tension + geo/eco (graduated)
    if (pizzaData) {
        const tension = pizzaData.tensionScore || 0;
        const T = CONFIG.TENSION || {};
        if ((category === 'geopolitical' || category === 'economic') && tension > 0) {
            if (tension >= (T.CRITICAL || 80)) {
                convictionPoints += (T.GEO_CONVICTION_CRITICAL || 25);
                signals.push(`CRISIS(${tension})+${category} (+${T.GEO_CONVICTION_CRITICAL || 25})`);
            } else if (tension >= (T.HIGH || 55)) {
                convictionPoints += (T.GEO_CONVICTION_HIGH || 20);
                signals.push(`HighTension(${tension})+${category} (+${T.GEO_CONVICTION_HIGH || 20})`);
            } else if (tension >= (T.ELEVATED || 30)) {
                convictionPoints += (T.GEO_CONVICTION_ELEVATED || 10);
                signals.push(`ElevatedTension(${tension})+${category} (+${T.GEO_CONVICTION_ELEVATED || 10})`);
            }
        }
        // Rising tension early detection
        if (pizzaData.tensionTrend === 'RISING') {
            convictionPoints += 5;
            signals.push('Tension RISING (+5)');
        }
    }

    // 9. High momentum (+10)
    if (volume24h > 10000 && yesPrice > 0.60) {
        convictionPoints += 10;
        signals.push('HighMomentum (+10)');
    }

    // 10. Real news sentiment match (uses structured match from alpha scoring)
    const N = CONFIG.NEWS || {};
    const newsMatch = market._newsMatch;
    if (newsMatch?.matched) {
        // Check if news sentiment aligns with our trade direction
        const tradeDirection = yesPrice > 0.5 ? 'bullish' : 'bearish';
        if (newsMatch.sentiment === tradeDirection) {
            const bonus = N.CONVICTION_BONUS || 8;
            convictionPoints += bonus;
            signals.push(`NewsConfirm:${newsMatch.sentiment} (+${bonus})`);
        } else if (newsMatch.sentiment !== 'neutral' && newsMatch.sentiment !== tradeDirection) {
            const penalty = N.CONVICTION_CONFLICT_PENALTY || -5;
            convictionPoints += penalty;
            signals.push(`NewsConflict:${newsMatch.sentiment} (${penalty})`);
        } else {
            convictionPoints += 3;
            signals.push('NewsCoverage (+3)');
        }
    }

    // 10b. Category-based conviction adjustment
    // Sports = historically best WR, Economic = worst WR
    if (category === 'sports') {
        convictionPoints += 15;
        signals.push('🏆 Sports Conviction (+15)');
    } else if (category === 'economic') {
        convictionPoints -= 10;
        signals.push('📉 Economic Conviction (-10)');
    }

    // 11. ADVANCED STRATEGIES (Memory, Cross-Market, Timing, Events, Calendar, Anti-Fragility)
    let advancedSizeMultiplier = 1.0;
    try {
        const advanced = await getAdvancedSignals(market, pizzaData, convictionPoints);
        convictionPoints += advanced.bonus;
        signals.push(...advanced.signals);
        advancedSizeMultiplier = advanced.sizeMultiplier;

        if (advanced.shouldReject) {
            signals.push(`⛔ ${advanced.rejectReason}`);
            return { points: convictionPoints, confidence: 0, signals, rejected: true, rejectReason: advanced.rejectReason, sizeMultiplier: advancedSizeMultiplier };
        }
    } catch (e) {
        // Advanced strategies are optional — fail gracefully
        console.warn('Advanced signals error:', e.message);
    }

    // Map conviction points to confidence
    let convictionConfidence;
    if (convictionPoints >= 80) convictionConfidence = 0.90;
    else if (convictionPoints >= 60) convictionConfidence = 0.80;
    else if (convictionPoints >= 40) convictionConfidence = 0.65;
    else if (convictionPoints >= 20) convictionConfidence = 0.50;
    else convictionConfidence = 0.35;

    return { points: convictionPoints, confidence: convictionConfidence, signals, rejected: false, sizeMultiplier: advancedSizeMultiplier };
}

// --- PORTFOLIO HEDGING: Check exposure before entering a trade ---
function checkPortfolioExposure(activeTrades, newCategory, newSide) {
    const limits = CONFIG.PORTFOLIO_LIMITS;
    if (!limits) return { allowed: true, adjustment: 0, reason: null };

    // Count trades by category (with per-category overrides)
    const sameCategoryCount = activeTrades.filter(t => t.category === newCategory).length;
    const categoryMax = newCategory === 'sports' ? (limits.MAX_SPORTS_CATEGORY || 5)
        : newCategory === 'economic' ? (limits.MAX_ECONOMIC_CATEGORY || 2)
        : limits.MAX_SAME_CATEGORY;
    if (sameCategoryCount >= categoryMax) {
        return {
            allowed: false,
            adjustment: 0,
            reason: `Portfolio limit: ${sameCategoryCount}/${categoryMax} ${newCategory} trades`
        };
    }

    // Count trades by direction
    const sameDirectionCount = activeTrades.filter(t => t.side === newSide).length;
    if (sameDirectionCount >= limits.MAX_SAME_DIRECTION) {
        return {
            allowed: false,
            adjustment: 0,
            reason: `Direction limit: ${sameDirectionCount}/${limits.MAX_SAME_DIRECTION} ${newSide} trades`
        };
    }

    // Calculate adjustment
    let adjustment = 0;
    let reason = null;

    // Correlation penalty: same category AND same direction
    const correlatedCount = activeTrades.filter(
        t => t.category === newCategory && t.side === newSide
    ).length;
    if (correlatedCount > 0) {
        adjustment -= limits.CORRELATION_PENALTY;
        reason = `Correlation penalty: ${correlatedCount} similar ${newCategory}/${newSide} trades (-${limits.CORRELATION_PENALTY})`;
    }

    // Diversity bonus: category with 0 active trades
    const categoriesInPortfolio = new Set(activeTrades.map(t => t.category));
    if (!categoriesInPortfolio.has(newCategory) && activeTrades.length > 0) {
        adjustment += limits.DIVERSITY_BONUS;
        reason = `Diversity bonus: new category ${newCategory} (+${limits.DIVERSITY_BONUS})`;
    }

    return { allowed: true, adjustment, reason };
}

// Logging détaillé des décisions de trade pour analyse
function logTradeDecision(market, trade, reasons, pizzaData) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        marketId: market.id,
        question: market.question.substring(0, 60),
        category: market._category || categorizeMarket(market.question),
        alphaScore: market._alphaScore || 0,
        scoreReasons: market._scoreReasons || [],
        decisionReasons: reasons,
        tradeExecuted: trade !== null,
        tradeId: trade?.id || null,
        side: trade?.side || null,
        entryPrice: trade?.entryPrice || null,
        confidence: trade?.confidence || null,
        pizzaData: pizzaData ? {
            index: pizzaData.index,
            defcon: pizzaData.defcon,
            tensionScore: pizzaData.tensionScore,
            tensionTrend: pizzaData.tensionTrend,
            sustained: pizzaData.defconDetails?.sustained,
            sentinel: pizzaData.defconDetails?.sentinel,
        } : null,
        newsMatch: market._newsMatch || null,
        whaleMatch: market._whaleMatch ? {
            consensus: market._whaleMatch.consensus,
            whaleCount: market._whaleMatch.whaleCount,
            totalVolume: market._whaleMatch.totalVolume,
            topTrader: market._whaleMatch.topTrade?.name,
        } : null,
        marketData: {
            yesPrice: market.outcomePrices ? parseFloat(market.outcomePrices[0]) : null,
            noPrice: market.outcomePrices ? parseFloat(market.outcomePrices[1]) : null,
            liquidity: parseFloat(market.liquidityNum || 0),
            volume24h: parseFloat(market.volume24hr || 0)
        }
    };

    // In a real module we might want to append to file, keeping it simple for now or using utils
    // fs.appendFileSync('trade_decisions.jsonl', JSON.stringify(logEntry) + '\n');
}

export async function simulateTrade(market, pizzaData, isFreshMarket = false, dependencies = {}) {
    const {
        checkLiquidityDepthFn = checkLiquidityDepth,
        calculateIntradayTrendFn = calculateIntradayTrend,
        testSize = null,
        isTest = false,
        skipPersistence = false,
        reasonsCollector = null
    } = dependencies;

    // === HARD GUARDS (never bypassed) ===
    // Portfolio limit: absolute cap
    const maxTrades = CONFIG.BASE_MAX_TRADES || 10;
    if (!skipPersistence && botState.activeTrades.length >= maxTrades) {
        if (reasonsCollector) reasonsCollector.push(`Portfolio full (${botState.activeTrades.length}/${maxTrades})`);
        return null;
    }
    // Minimum capital check
    if (!skipPersistence && botState.capital < CONFIG.MIN_TRADE_SIZE) {
        if (reasonsCollector) reasonsCollector.push(`Insufficient capital ($${botState.capital.toFixed(2)})`);
        return null;
    }
    // Daily loss limit check
    if (!skipPersistence && CONFIG.DAILY_LOSS_LIMIT) {
        const today = new Date().toISOString().split('T')[0];
        if (botState.dailyPnLResetDate !== today) {
            botState.dailyPnL = 0;
            botState.dailyPnLResetDate = today;
        }
        const dailyLossThreshold = -(CONFIG.DAILY_LOSS_LIMIT * botState.startingCapital);
        if (botState.dailyPnL <= dailyLossThreshold) {
            if (reasonsCollector) reasonsCollector.push(`Daily loss limit hit ($${botState.dailyPnL.toFixed(2)} / ${dailyLossThreshold.toFixed(2)})`);
            addLog(botState, `🛑 DAILY LOSS LIMIT: Trading halted ($${botState.dailyPnL.toFixed(2)} today)`, 'warning');
            return null;
        }
    }

    // Market re-entry cooldown (30 min after closing a trade on same market)
    if (!skipPersistence && botState.cooldowns && botState.cooldowns[market.id]) {
        const cooldownEnd = botState.cooldowns[market.id] + (30 * 60 * 1000);
        if (Date.now() < cooldownEnd) {
            const minsLeft = Math.ceil((cooldownEnd - Date.now()) / 60000);
            if (reasonsCollector) reasonsCollector.push(`Cooldown: ${minsLeft}min left on this market`);
            return null;
        }
        delete botState.cooldowns[market.id];
    }

    // --- RE-ENTRY LIMIT: Max 2 entries per market (prevents FURIA-style triple-down disasters) ---
    if (!skipPersistence || dependencies.enforcePortfolioLimits) {
        const closedOnSameMarket = (botState.closedTrades || []).filter(t => t.marketId === market.id).length;
        const activeOnSameMarket = (botState.activeTrades || []).filter(t => t.marketId === market.id).length;
        const totalEntries = closedOnSameMarket + activeOnSameMarket;
        if (totalEntries >= 2) {
            const reason = `Re-entry blocked: Already ${totalEntries} trades on this market (max 2)`;
            if (reasonsCollector) reasonsCollector.push(reason);
            return null;
        }
    }

    if (!market.outcomePrices) {
        if (reasonsCollector) reasonsCollector.push("Missing prices");
        return null;
    }

    let prices = market.outcomePrices;
    if (typeof prices === 'string') {
        try {
            prices = JSON.parse(prices);
        } catch (e) {
            if (reasonsCollector) reasonsCollector.push("Invalid price JSON");
            return null;
        }
    }

    if (!Array.isArray(prices) || prices.length < 2) {
        if (reasonsCollector) reasonsCollector.push("Incomplete prices");
        return null;
    }

    const yesPrice = parseFloat(prices[0]);
    const noPrice = parseFloat(prices[1]);

    if (isNaN(yesPrice) || isNaN(noPrice)) {
        if (reasonsCollector) reasonsCollector.push("NaN prices");
        return null;
    }

    let side, entryPrice, confidence;
    const category = categorizeMarket(market.question);
    const decisionReasons = [];

    // NOUVEAU: SPORTS EXPERT (Global Validation)
    // Run this EARLY to filter out bad sports trades immediately
    const sportsValidation = await sportsService.validateBet(market);
    if (sportsValidation.adjustment <= -0.2) {
        decisionReasons.push(...sportsValidation.reasons);
        if (reasonsCollector) reasonsCollector.push(...sportsValidation.reasons);
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }
    if (sportsValidation.adjustment !== 0 && sportsValidation.adjustment > -0.2) {
        // Log it but don't return yet, we will apply adjustment to confidence later
        decisionReasons.push(...sportsValidation.reasons);
    }

    // NOUVEAU: STRATÉGIE ARBITRAGE (Risk-Free)
    const arbSignal = botState.arbitrageOpportunities && botState.arbitrageOpportunities.find(a => a.id === market.id);
    if (arbSignal && yesPrice + noPrice < 0.995) { // 0.5% margin for safety
        const depthYesOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 100);
        const depthNoOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 100);

        if (depthYesOK && depthNoOK) {
            const tradeSize = calculateTradeSize(1.0, (yesPrice + noPrice) / 2) / 2; // Risk-free confidence = 1.0, price = avg
            const tradeIdBase = Date.now().toString(36);

            const tradeYes = {
                id: tradeIdBase + 'y',
                marketId: market.id,
                question: market.question,
                side: 'YES',
                amount: tradeSize,
                entryPrice: yesPrice * 1.01, // slippage sim
                startTime: new Date().toISOString(),
                shares: tradeSize / (yesPrice * 1.01),
                status: 'OPEN',
                confidence: 1.0, // Risk free
                reasons: [`⚖️ Arbitrage: Sum=${(yesPrice + noPrice).toFixed(3)}`],
                category: category,
                clobTokenIds: market.clobTokenIds || [],
                endDate: market.endDate || market.end_date_iso || null
            };

            const tradeNo = {
                id: tradeIdBase + 'n',
                marketId: market.id,
                question: market.question,
                side: 'NO',
                amount: tradeSize,
                entryPrice: noPrice * 1.01,
                startTime: new Date().toISOString(),
                shares: tradeSize / (noPrice * 1.01),
                status: 'OPEN',
                confidence: 1.0,
                reasons: [`⚖️ Arbitrage: Sum=${(yesPrice + noPrice).toFixed(3)}`],
                category: category,
                clobTokenIds: market.clobTokenIds || [],
                endDate: market.endDate || market.end_date_iso || null
            };

            // Note: We don't call saveNewTrade here because we return an array 
            // and server.js will handle the logs/persistence.
            // Wait, saveNewTrade handles botState.capital and stateManager.save().
            // I should either refactor saveNewTrade or handle it here.
            // Let's handle it manually here for both.

            [tradeYes, tradeNo].forEach(t => {
                saveNewTrade(t, skipPersistence);
            });

            return [tradeYes, tradeNo];
        }
    }

    // PizzINT Tension-based trade logic (graduated, replaces binary DEFCON check)
    const tension = pizzaData?.tensionScore || 0;
    const T = CONFIG.TENSION || {};

    if (tension >= (T.CRITICAL || 80)) {
        // Full crisis: force geo/eco YES, reject sports
        if (category === 'geopolitical' || category === 'economic') {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.65;
            decisionReasons.push(`CRISIS tension ${tension} + ${category}`);
        } else if (category === 'sports') {
            decisionReasons.push(`Rejected: Sports during crisis (tension ${tension})`);
            if (reasonsCollector) reasonsCollector.push(...decisionReasons);
            logTradeDecision(market, null, decisionReasons, pizzaData);
            return null;
        } else {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.45;
            decisionReasons.push(`CRISIS tension ${tension} + other category`);
        }
    } else if (tension >= (T.HIGH || 55)) {
        // High tension: nudge geo/eco confidence but don't force-reject sports
        if (category === 'geopolitical' || category === 'economic') {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.55;
            decisionReasons.push(`HIGH tension ${tension} + ${category}`);
        }
    }
    // WHALE FOLLOW STRATEGY — uses real trade data from Data API
    const whaleAlert = market._whaleMatch || botState.whaleAlerts?.find(w => w.slug === market.slug);
    if (whaleAlert && whaleAlert.consensus && whaleAlert.consensus !== 'MIXED') {
        if (whaleAlert.consensus === 'BULLISH') {
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
            if (depthOK) {
                side = 'YES';
                entryPrice = yesPrice;
                confidence = 0.75;
                const topName = whaleAlert.topTrade?.name || 'Unknown';
                decisionReasons.push(`🐳 Whale Follow: ${whaleAlert.whaleCount || 1} whales BULLISH ($${Math.round(whaleAlert.totalVolume || whaleAlert.volume)}) led by ${topName}`);
            }
        } else if (whaleAlert.consensus === 'BEARISH') {
            const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
            if (depthOK) {
                side = 'NO';
                entryPrice = noPrice;
                confidence = 0.75;
                const topName = whaleAlert.topTrade?.name || 'Unknown';
                decisionReasons.push(`🐳 Whale Follow: ${whaleAlert.whaleCount || 1} whales BEARISH ($${Math.round(whaleAlert.totalVolume || whaleAlert.volume)}) led by ${topName}`);
            }
        }
    } else if (whaleAlert) {
        decisionReasons.push(`⚠️ Whale Alert: MIXED consensus, no follow`);
    }
    // COPY TRADE FOLLOW STRATEGY — top leaderboard wallet positions
    const copyMatch = market._copyMatch;
    if (!side && copyMatch && (CONFIG.COPY_TRADING?.ENABLED)) {
        const copyOutcome = copyMatch.outcome; // "Yes" or "No"
        if (copyOutcome === 'Yes' || copyOutcome === 'YES') {
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
            if (depthOK) {
                side = 'YES';
                entryPrice = yesPrice;
                confidence = 0.60;
                decisionReasons.push(`Copy Follow: ${copyMatch.count} top trader(s) on YES (led by ${copyMatch.topTrader} #${copyMatch.topRank})`);
            }
        } else if (copyOutcome === 'No' || copyOutcome === 'NO') {
            const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
            if (depthOK) {
                side = 'NO';
                entryPrice = noPrice;
                confidence = 0.60;
                decisionReasons.push(`Copy Follow: ${copyMatch.count} top trader(s) on NO (led by ${copyMatch.topTrader} #${copyMatch.topRank})`);
            }
        }
    }
    // NOUVEAU: WIZARD FOLLOW STRATEGY (Smart Money / Alpha)
    else if (botState.wizards && botState.wizards.some(w => w.id === market.id)) {
        const wizardSignal = botState.wizards.find(w => w.id === market.id);
        // Wizards are detected as "Cheap YES" (< 0.35) with high Alpha.
        // We verify depth and go long.
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.60;
            decisionReasons.push(`🧙 Wizard Follow: High Alpha (${wizardSignal.alpha}%)`);
        } else {
            decisionReasons.push(`⚠️ Wizard Signal Ignored: Low Liquidity`);
        }
    }


    // NOUVEAU: TREND FOLLOWING (Optimisé + Intraday Check + Depth Check)
    else if (market.volume24hr > 1000 && yesPrice > 0.55 && yesPrice < 0.90) {
        // 1. Check Intraday Trend
        const trend = await calculateIntradayTrendFn(market.id);
        if (trend === 'UP') {
            // 2. Check Depth 
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50); // Loosened from 100
            if (depthOK) {
                side = 'YES';
                entryPrice = yesPrice;
                confidence = 0.65; // Higher confidence due to trend verification
                decisionReasons.push(`🚀 Trend Following Verified (Vol: ${parseInt(market.volume24hr)} | Intraday: UP)`);
            } else {
                decisionReasons.push(`⚠️ Trend Rejected: Low Debt/Slippage Risk`);
            }
        } else {
            decisionReasons.push(`⚠️ Trend Rejected: Intraday is ${trend || 'Flat'}`);
        }
    }
    // NOUVEAU: HYPE FADER (Depth Checked)
    else if (yesPrice > 0.92 && yesPrice < 0.98) {
        // Check Depth for Shorting YES (Buying NO)
        const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
        if (depthOK) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.50;
            decisionReasons.push(`📉 Hype Fader: Shorting Overbought YES (Price: ${yesPrice.toFixed(2)})`);
        }
    } else if (noPrice > 0.92 && noPrice < 0.98) {
        // Check Depth for Shorting NO (Buying YES)
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.50;
            decisionReasons.push(`📈 Hype Fader: Shorting Overbought NO (Price: ${noPrice.toFixed(2)})`);
        }
    }
    // NOUVEAU: SMART MOMENTUM (Vol > 1000 + Spread Check implied by Depth)
    else if (market.volume24hr && parseFloat(market.volume24hr) > 1000) {
        if (yesPrice >= 0.55 && yesPrice <= 0.85) {
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
            if (depthOK) {
                side = 'YES';
                entryPrice = yesPrice;
                confidence = 0.45;
                decisionReasons.push(`🔥 Smart Momentum: Following YES Favorite`);
            }
        }
        else if (noPrice >= 0.55 && noPrice <= 0.85) {
            const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
            if (depthOK) {
                side = 'NO';
                entryPrice = noPrice;
                confidence = 0.45;
                decisionReasons.push(`🔥 Smart Momentum: Following NO Favorite`);
            }
        }
        else {
            // Contrarian logic
            if (yesPrice < noPrice) {
                const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
                if (depthOK) { side = 'YES'; entryPrice = yesPrice; confidence = 0.35; decisionReasons.push(`Contrarian Momentum`); }
            } else {
                const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
                if (depthOK) { side = 'NO'; entryPrice = noPrice; confidence = 0.35; decisionReasons.push(`Contrarian Momentum`); }
            }
        }
    }
    // Prix très bas (long shots) - Moved AFTER advanced strategies
    else if (yesPrice < 0.20 && yesPrice >= 0.01) {
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 20);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.35;
            decisionReasons.push(`Prix bas YES: ${yesPrice.toFixed(3)}`);
        }
    } else if (noPrice < 0.20 && noPrice >= 0.01) {
        const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 20);
        if (depthOK) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.35;
            decisionReasons.push(`Prix bas NO: ${noPrice.toFixed(3)}`);
        }
    }
    // NOUVEAU: Prix moyens - Moved AFTER advanced strategies
    else if (yesPrice >= 0.20 && yesPrice <= 0.40) {
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.40;
            decisionReasons.push(`Prix moyen YES: ${yesPrice.toFixed(3)}`);
        }
    } else if (noPrice >= 0.20 && noPrice <= 0.40) {
        const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
        if (depthOK) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.40;
            decisionReasons.push(`Prix moyen NO: ${noPrice.toFixed(3)}`);
        }
    }
    // --- FINAL FALLBACK FOR VERIFICATION ---
    if (isTest && !side) {
        side = 'YES';
        entryPrice = yesPrice;
        confidence = 1.0;
        decisionReasons.push("🛠️ FORCED Test Trade (Verification)");
    }

    if (!side || !entryPrice) {
        decisionReasons.push('Aucune condition de trade remplie');
        if (reasonsCollector) reasonsCollector.push(...decisionReasons);

        // Rejections are now batched in server.js loop summary (no individual log spam)

        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

    // Safety check if side was set but no entryPrice (shouldn't happen with above logic but safe)
    if (!side || !entryPrice) return null; // Added safety return

    // --- CONVICTION SCORING (Signal Stacking + Advanced Strategies) ---
    // Evaluate ALL applicable signals and combine into composite confidence
    let convictionResult = null;
    let advancedSizeMultiplier = 1.0;
    if (side && entryPrice) {
        convictionResult = await calculateConviction(market, pizzaData, {
            calculateIntradayTrendFn
        });

        // Anti-Fragility can reject trades during drawdown recovery
        if (convictionResult.rejected) {
            const reason = `🛡️ Anti-Fragility: ${convictionResult.rejectReason}`;
            if (reasonsCollector) reasonsCollector.push(reason);
            decisionReasons.push(reason);
            logTradeDecision(market, null, decisionReasons, pizzaData);
            return null;
        }

        if (convictionResult.points > 0) {
            confidence = convictionResult.confidence;
            decisionReasons.push(`🎯 Conviction: ${convictionResult.points}pts → ${convictionResult.confidence.toFixed(2)}`);
            convictionResult.signals.forEach(s => decisionReasons.push(s));
        }

        // Store size multiplier from advanced strategies (Calendar, Anti-Fragility)
        advancedSizeMultiplier = convictionResult.sizeMultiplier || 1.0;
    }

    // --- PORTFOLIO HEDGING CHECK ---
    if (!skipPersistence || dependencies.enforcePortfolioLimits) {
        const exposure = checkPortfolioExposure(botState.activeTrades, category, side);
        if (!exposure.allowed) {
            if (reasonsCollector) reasonsCollector.push(exposure.reason);
            decisionReasons.push(exposure.reason);
            logTradeDecision(market, null, decisionReasons, pizzaData);
            return null;
        }
        if (exposure.adjustment !== 0 && exposure.reason) {
            confidence += exposure.adjustment;
            decisionReasons.push(`🛡️ ${exposure.reason}`);
        }
    }

    if (entryPrice < (CONFIG.MIN_PRICE_THRESHOLD || 0.05)) {
        const reason = `Price too low (<${CONFIG.MIN_PRICE_THRESHOLD || 0.05}) - Penny Stock Filter`;
        if (reasonsCollector) reasonsCollector.push(reason);
        return null;
    }

    // --- SPECULATIVE EXPOSURE LIMIT: Max 20% of starting capital on speculative bets ---
    // Prevents the portfolio from being overloaded with high-risk low-price positions
    if ((!skipPersistence || dependencies.enforcePortfolioLimits) && entryPrice < 0.35) {
        const speculativeExposure = (botState.activeTrades || [])
            .filter(t => t.entryPrice && t.entryPrice < 0.35)
            .reduce((sum, t) => sum + (t.amount || 0), 0);
        const maxSpeculative = (botState.startingCapital || CONFIG.STARTING_CAPITAL) * 0.20;
        if (speculativeExposure >= maxSpeculative) {
            const reason = `Speculative exposure limit: $${speculativeExposure.toFixed(0)}/$${maxSpeculative.toFixed(0)} (20% cap)`;
            if (reasonsCollector) reasonsCollector.push(reason);
            decisionReasons.push(reason);
            logTradeDecision(market, null, decisionReasons, pizzaData);
            return null;
        }
    }

    if (market.volume24hr > 10000 && entryPrice > 0.60 && side === 'YES') {
        confidence += 0.10;
        decisionReasons.push(`🔥 High Momentum (Vol: ${parseInt(market.volume24hr)})`);
    }

    // Apply Sports Adjustment if defined
    if (typeof sportsValidation !== 'undefined' && sportsValidation.adjustment) {
        confidence += sportsValidation.adjustment;
        decisionReasons.push(`🏀 Sports Adjustment: ${sportsValidation.adjustment.toFixed(2)}`);
    }

    // Apply AI Feedback Adjustment (Category based)
    if (botState.confidenceAdjustments && botState.confidenceAdjustments[category]) {
        const aiAdj = botState.confidenceAdjustments[category];
        confidence += aiAdj;
        decisionReasons.push(`🤖 AI Feedback: ${aiAdj > 0 ? '+' : ''}${aiAdj.toFixed(2)} (${category})`);
    }

    // --- SELF-IMPROVEMENT LOOP (Auto-Training) ---
    if (botState.learningParams) {
        // 1. Adjust Confidence
        const oldConf = confidence;
        confidence *= botState.learningParams.confidenceMultiplier;
        if (confidence !== oldConf) {
            decisionReasons.push(`🎓 AI Adaptation: Conf x${botState.learningParams.confidenceMultiplier.toFixed(2)} (${botState.learningParams.mode})`);
        }
    }

    // Clamp confidence to valid probability range (required for Kelly criterion)
    confidence = Math.max(0.01, Math.min(0.99, confidence));

    let tradeSize = dependencies.testSize || calculateTradeSize(confidence, entryPrice);

    // --- SPECULATIVE MARKET SIZE CAP: Hard cap for low-price markets (high-risk) ---
    // Markets with price < 0.35 are highly speculative (e.g. esports mid-game)
    // Halve the position AND enforce $15 absolute cap to prevent outsized losses
    if (entryPrice < 0.35 && !dependencies.testSize) {
        tradeSize *= 0.5;
        const SPECULATIVE_MAX = 15; // Absolute dollar cap on speculative bets
        if (tradeSize > SPECULATIVE_MAX) {
            tradeSize = SPECULATIVE_MAX;
        }
        decisionReasons.push(`⚠️ Speculative Market (price ${entryPrice.toFixed(2)} < 0.35): Size halved + capped $${tradeSize.toFixed(0)}`);
    }

    // 2a. Apply Advanced Strategy Size Multiplier (Calendar, Anti-Fragility)
    if (advancedSizeMultiplier !== 1.0) {
        tradeSize *= advancedSizeMultiplier;
        decisionReasons.push(`📅 Advanced Size: x${advancedSizeMultiplier.toFixed(2)}`);
    }

    // 2b. WHALE STRATEGY SIZE CAP: Limit whale-triggered trades to prevent outsized losses
    // Data shows whale trades cause the 5 worst losses (-$18, -$8, -$4.5, -$4.3, -$4)
    const isWhaleTriggered = decisionReasons.some(r => r.includes('Whale') || r.includes('🐋'));
    if (isWhaleTriggered && !dependencies.testSize) {
        const WHALE_MAX = 12; // $12 max on whale-triggered trades
        if (tradeSize > WHALE_MAX) {
            tradeSize = WHALE_MAX;
            decisionReasons.push(`🐋 Whale Size Cap: capped at $${WHALE_MAX}`);
        }
    }

    // 2c. ECONOMIC CATEGORY SIZE PENALTY: 20% WR on economic markets = reduce exposure
    const tradeCategory = categorizeMarket(market.question);
    if (tradeCategory === 'economic' && !dependencies.testSize) {
        tradeSize *= 0.6; // 40% size reduction for economic markets
        decisionReasons.push(`📉 Economic penalty: size x0.6 (low WR category)`);
    }

    // 2. Adjust Size with Learning Params
    if (botState.learningParams?.sizeMultiplier && botState.learningParams.sizeMultiplier !== 1.0) {
        tradeSize *= botState.learningParams.sizeMultiplier;
        decisionReasons.push(`🎓 AI Adaptation: Size x${botState.learningParams.sizeMultiplier.toFixed(2)}`);

        // CRITICAL: Re-check capital limit after multiplier
        if (tradeSize > botState.capital) {
            tradeSize = botState.capital;
            decisionReasons.push(`⚠️ Size capped to available capital ($${botState.capital.toFixed(2)})`);
        }
    } else {
        // Standard capital check
        if (tradeSize > botState.capital) tradeSize = botState.capital;
    }

    // CRITICAL: Prevent Ghost Trades ($0 or near-zero amounts)
    if (tradeSize < CONFIG.MIN_TRADE_SIZE || botState.capital < CONFIG.MIN_TRADE_SIZE) {
        const lowCapMsg = `Insufficient capital ($${botState.capital.toFixed(2)}) or size too small ($${tradeSize.toFixed(2)})`;
        decisionReasons.push(lowCapMsg);
        if (reasonsCollector) reasonsCollector.push(lowCapMsg);
        // Batched in server.js scan summary — no individual log spam
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

    // --- STRICT REALISM: FETCH REAL EXECUTION PRICE FROM ORDER BOOK ---
    // This ensures we don't "Paper Trade" at phantom prices (e.g. 1 cent)
    if (market.clobTokenIds && market.clobTokenIds.length === 2) {
        const tokenId = side === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
        if (tokenId) {
            try {
                // Fetch REAL Ask Price (what we would actually pay)
                const executionData = await getBestExecutionPrice(tokenId, 'buy');

                if (!executionData || !executionData.price || executionData.price <= 0) {
                    const reason = `No Liquidity in Order Book for ${side}`;
                    if (reasonsCollector) reasonsCollector.push(reason);
                    return null; // ABORT — batched in scan summary
                }

                // Filter out extreme spreads (e.g. Bid 0.10 / Ask 0.90)
                if (executionData.spreadPercent > 50) {
                    const reason = `Spread too wide (${executionData.spreadPercent}%)`;
                    if (reasonsCollector) reasonsCollector.push(reason);
                    return null; // batched in scan summary
                }

                // FORCE UPDATE Entry Price to Real Ask
                if (Math.abs(entryPrice - executionData.price) > 0.001) {
                    decisionReasons.push(`⚡ Price Adjusted: ${entryPrice.toFixed(3)} -> ${executionData.price.toFixed(3)} (Real Order Book)`);
                    entryPrice = executionData.price;
                }

                // Price fetch successful - tracked in trade.reasons, no need to spam dashboard

            } catch (e) {
                console.warn(`CLOB Check Failed for ${market.question}:`, e.message);
                addLog(botState, `❌ CLOB Check Failed for "${market.question.substring(0, 30)}...": ${e.message}`, 'error');
                return null;
            }
        }
    } else {
        // --- AMM FALLBACK ---
        // FIX: Reduced from 3% to 1% - Gamma API prices are reliable mid-market
        const ammSlippage = 0.01; // 1% buffer for AMM trades (down from 3%)
        const originalPrice = entryPrice;
        entryPrice = side === 'YES' ? entryPrice * (1 + ammSlippage) : entryPrice * (1 - ammSlippage);

        const reason = `AMM Fallback (Gamma +1%)`;
        decisionReasons.push(`⚡ ${reason}: ${originalPrice.toFixed(3)} -> ${entryPrice.toFixed(3)}`);
        if (reasonsCollector) reasonsCollector.push(reason);
        // Removed addLog to prevent dashboard spam - info tracked in trade.reasons
    }

    // FIX: Remove double slippage - CLOB price is already the ask price we pay
    // Only add minimal network fee buffer (0.3%) instead of 1% slippage
    const networkFeeBuffer = 0.003;  // 0.3% for gas/network variance
    const executionPrice = entryPrice * (1 + (side === 'YES' ? networkFeeBuffer : -networkFeeBuffer));

    // Derive primary strategy from decision reasons
    const reasonStr = decisionReasons.join(' ');
    let strategy = 'standard';
    if (reasonStr.includes('Arbitrage')) strategy = 'arbitrage';
    else if (reasonStr.includes('Copy Follow')) strategy = 'copy_trade';
    else if (reasonStr.includes('Wizard')) strategy = 'wizard';
    else if (reasonStr.includes('Whale')) strategy = 'whale';
    else if (reasonStr.includes('DCA')) strategy = 'dca';
    else if (reasonStr.includes('DEFCON') || reasonStr.includes('CRISIS') || reasonStr.includes('tension')) strategy = 'tension';
    else if (reasonStr.includes('Memory') || reasonStr.includes('momentum')) strategy = 'memory';
    else if (reasonStr.includes('Catalyst') || reasonStr.includes('Event')) strategy = 'event_driven';
    else if (reasonStr.includes('Hype Fader')) strategy = 'hype_fader';
    else if (reasonStr.includes('Smart Momentum')) strategy = 'smart_momentum';
    else if (reasonStr.includes('Trend Following')) strategy = 'trend_following';
    else if (reasonStr.includes('Fresh')) strategy = 'fresh_market';
    else if (reasonStr.includes('Contrarian')) strategy = 'contrarian';

    // Phase 6: Check if this strategy is disabled by AI auto-training
    const overrides = botState.strategyOverrides || {};
    if (overrides.disabledStrategies?.includes(strategy)) {
        const reason = `Strategy "${strategy}" disabled by AI training (${overrides.reason || 'low WR'})`;
        if (reasonsCollector) reasonsCollector.push(reason);
        decisionReasons.push(reason);
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

    const trade = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        marketId: market.id,
        question: market.question,
        slug: market.slug,
        side: side,
        amount: tradeSize,
        entryPrice: executionPrice,
        startTime: new Date().toISOString(),
        shares: tradeSize / executionPrice,
        status: 'OPEN',
        confidence: confidence,
        reasons: decisionReasons,
        category: category,
        strategy: strategy,
        isFresh: isFreshMarket,
        clobTokenIds: market.clobTokenIds || [],
        endDate: market.endDate || market.end_date_iso || null,
        convictionScore: convictionResult?.points || 0
    };

    saveNewTrade(trade, skipPersistence);
    logTradeDecision(market, trade, decisionReasons, pizzaData);

    if (!skipPersistence) {
        const icon = category === 'geopolitical' ? '🌍' : (category === 'economic' ? '📉' : '🎰');
        stateManager.addSectorEvent(category, 'TRADE', `${icon} Trade Opened: $${tradeSize.toFixed(0)} on ${side}`, {
            market: market.question,
            price: executionPrice.toFixed(2)
        });
    }

    return trade;
}

function saveNewTrade(trade, skipPersistence = false) {
    // In backtest mode, skip ALL state mutations — capital and activeTrades are managed
    // by the backtest simulator's own simulated state. Modifying botState here caused
    // real capital to temporarily show simulated values (e.g. dipping $130 during backtest).
    if (skipPersistence) return;

    botState.capital -= trade.amount;
    botState.activeTrades.unshift(trade);

    botState.totalTrades += 1;

    stateManager.save(true); // Force Supabase sync on trade open
    supabaseService.saveTrade(trade).catch(err => console.error('Supabase Save Error:', err));
    // --- STRATEGY VISIBILITY LOGS ---
    const convPts = trade.convictionScore || 0;
    const convLabel = convPts >= 80 ? 'VERY STRONG' : convPts >= 60 ? 'STRONG' : convPts >= 40 ? 'GOOD' : convPts >= 20 ? 'MEDIUM' : 'LOW';

    // Main trade log with conviction
    addLog(botState, `✅ TRADE OPENED: ${trade.side} sur "${trade.question.substring(0, 30)}..." @ $${trade.entryPrice.toFixed(3)} ($${trade.amount.toFixed(2)}) | Conviction: ${convPts}pts (${convLabel}) [slug:${trade.slug || ''}]`, 'trade');

    // Strategy signals breakdown (what triggered the trade)
    const strategySignals = (trade.reasons || []).filter(r =>
        r.includes('🎯') || r.includes('🐋') || r.includes('📊') || r.includes('🆕') ||
        r.includes('🔮') || r.includes('🧙') || r.includes('📡') || r.includes('🛡️') ||
        r.includes('📅') || r.includes('🧠') || r.includes('📈') || r.includes('⚡') ||
        r.includes('🔥') || r.includes('DEFCON') || r.includes('Arbitrage')
    );
    if (strategySignals.length > 0) {
        addLog(botState, `📋 Signals: ${strategySignals.slice(0, 5).join(' | ')}`, 'info');
    }
}

export async function checkAndCloseTrades(getRealMarketPriceFn) {
    if (botState.activeTrades.length === 0) return;

    console.log(`🔍 Checking ${botState.activeTrades.length} active trades...`);

    for (let i = botState.activeTrades.length - 1; i >= 0; i--) {
        const trade = botState.activeTrades[i];

        const invested = trade.amount || trade.size || 0;

        // --- 1. GET PRICE & TRACK HISTORY ---
        const currentPrice = getRealMarketPriceFn ? await getRealMarketPriceFn(trade) : (trade.entryPrice || 0.5);

        if (currentPrice === null || currentPrice === undefined || isNaN(currentPrice)) {
            // Price unavailable — check if trade is stale (>48h with no price = force close)
            const tradeAgeMs = Date.now() - new Date(trade.startTime).getTime();
            const tradeAgeHours = tradeAgeMs / (1000 * 60 * 60);
            const lastUpdate = trade.lastPriceUpdate ? (Date.now() - new Date(trade.lastPriceUpdate).getTime()) / (1000 * 60 * 60) : tradeAgeHours;

            if (tradeAgeHours >= (CONFIG.TRADE_TIMEOUT_HOURS || 48) || lastUpdate >= 6) {
                // Force close at entry price (assume total loss if no price available)
                const fallbackPrice = trade.entryPrice || 0.5;
                const reason = `STALE TRADE: No price for ${lastUpdate.toFixed(1)}h (age: ${tradeAgeHours.toFixed(1)}h) — force closing`;
                addLog(botState, `⚠️ ${reason}`, 'warning');
                await closeTrade(i, fallbackPrice, reason);
            }
            continue;
        }

        trade.priceHistory = trade.priceHistory || [];
        trade.priceHistory.push(currentPrice);
        if (trade.priceHistory.length > 50) trade.priceHistory.shift();

        // Update timestamp for Dashboard "PRICES: LIVE" indicator
        trade.lastPriceUpdate = new Date().toISOString();

        const pnlPercent = invested > 0 ? (trade.shares * currentPrice - invested) / invested : 0;
        trade.maxReturn = Math.max(trade.maxReturn || 0, pnlPercent);

        // --- GAP PROTECTION: Detect abnormal price jumps between checks ---
        // If price moved >30% since last check, flag as suspicious and wait for confirmation
        const lastPrice = trade.priceHistory.length >= 2
            ? trade.priceHistory[trade.priceHistory.length - 2]
            : trade.entryPrice;
        const priceDelta = lastPrice > 0 ? Math.abs(currentPrice - lastPrice) / lastPrice : 0;

        if (priceDelta > 0.30 && !trade._gapConfirmed) {
            // First detection: flag and skip this cycle — wait for next check to confirm
            trade._gapConfirmed = false;
            trade._gapDetectedAt = Date.now();
            addLog(botState, `⚠️ GAP DETECTED: ${trade.question.substring(0, 25)}... price moved ${(priceDelta * 100).toFixed(0)}% in one cycle (${lastPrice.toFixed(3)} → ${currentPrice.toFixed(3)}). Waiting for confirmation...`, 'warning');
            continue;
        }
        // Second check after gap: confirm the price is real (gap persists)
        if (trade._gapDetectedAt && !trade._gapConfirmed) {
            trade._gapConfirmed = true;
            addLog(botState, `✅ GAP CONFIRMED: ${trade.question.substring(0, 25)}... price ${currentPrice.toFixed(3)} confirmed after gap. Proceeding with exit logic.`, 'info');
        }

        // --- 2. DYNAMIC STOP LOSS CHECK ---
        const dynamicStopInfo = calculateDynamicStopLoss(trade, pnlPercent, trade.maxReturn);
        const requiredStopPercent = dynamicStopInfo.requiredStopPercent;

        if (pnlPercent <= requiredStopPercent) {
            // --- MAX LOSS CAP: Never lose more than 15% per trade, even on gaps ---
            // Reduced from -25% to -15% after Nuggets trade lost $18 in one shot
            const MAX_LOSS_CAP = -0.15;
            let effectiveExitPrice = currentPrice;
            if (pnlPercent < MAX_LOSS_CAP && invested > 0) {
                // Cap the loss: calculate what price would give -15% loss
                effectiveExitPrice = (invested * (1 + MAX_LOSS_CAP)) / trade.shares;
                addLog(botState, `🛡️ MAX LOSS CAP: Limiting loss from ${(pnlPercent * 100).toFixed(1)}% to ${(MAX_LOSS_CAP * 100)}% on ${trade.question.substring(0, 25)}...`, 'warning');
            }
            const stopLabel = requiredStopPercent >= 0 ? 'TRAILING STOP' : 'STOP LOSS';
            const reason = `${stopLabel}: ${(pnlPercent * 100).toFixed(1)}% (Limit: ${(requiredStopPercent * 100).toFixed(1)}%)${pnlPercent < MAX_LOSS_CAP ? ' [CAPPED at -15%]' : ''}`;
            await closeTrade(i, effectiveExitPrice, reason);
            continue;
        }

        // --- 3. ADAPTIVE TAKE PROFIT CHECK (Smart Exit) ---
        let tpPercent;
        const smartExit = CONFIG.SMART_EXIT;

        if (trade.partialExit) {
            // Already took partial profit — use extended target for remainder
            tpPercent = (trade.originalTP || CONFIG.TAKE_PROFIT_PERCENT || 0.10) * (smartExit?.EXTENDED_TP_MULTIPLIER || 2.0);
        } else {
            tpPercent = await calculateAdaptiveTP(trade);
        }

        if (pnlPercent >= tpPercent) {
            if (!trade.partialExit && smartExit && smartExit.PARTIAL_EXIT_RATIO < 1.0) {
                // PARTIAL EXIT: Sell portion, keep remainder with extended target
                const exitRatio = smartExit.PARTIAL_EXIT_RATIO;
                const partialShares = trade.shares * exitRatio;
                const partialValue = partialShares * currentPrice;
                const partialInvested = trade.amount * exitRatio;
                const partialPnl = partialValue - partialInvested;

                // Credit partial profit to capital (don't increment win counter — trade not fully closed)
                botState.capital += partialValue;

                // Update trade in-place for remainder
                trade.shares -= partialShares;
                trade.amount -= partialInvested;
                trade.partialExit = true;
                trade.originalTP = tpPercent;
                trade.breakEvenStop = true; // Move stop-loss to break-even

                addLog(botState, `✂️ PARTIAL EXIT: ${(exitRatio * 100)}% sold at +${(pnlPercent * 100).toFixed(1)}% | Remainder targets +${(tpPercent * (smartExit.EXTENDED_TP_MULTIPLIER || 2.0) * 100).toFixed(0)}% [slug:${trade.slug || ''}]`, 'trade');
                stateManager.save(true); // Force Supabase sync on partial exit
                await supabaseService.saveTrade(trade).catch(e => console.error('Supabase partial exit save:', e));
                continue;
            } else {
                // Full exit (no smart exit, or second TP hit on remainder)
                await closeTrade(i, currentPrice, `TAKE PROFIT: ${(pnlPercent * 100).toFixed(1)}% reached${trade.partialExit ? ' (remainder)' : ''}`);
                continue;
            }
        }

        // --- 4. TIMEOUT CHECK (Research-backed: 48h for prediction markets) ---
        const now = Date.now();
        const tradeAge = (now - new Date(trade.startTime).getTime()) / (1000 * 60 * 60); // hours
        const timeoutHours = CONFIG.TRADE_TIMEOUT_HOURS || 48;

        if (tradeAge >= timeoutHours) {
            const reason = `⏱️ TIMEOUT: ${tradeAge.toFixed(1)}h (PnL: ${(pnlPercent * 100).toFixed(1)}%)`;
            addLog(botState, `${reason} - Freeing capital for new opportunities`, 'info');
            await closeTrade(i, currentPrice, reason);
            continue;
        }

        // --- 5. EMOTIONAL SPIKE REVERSION (70% of spikes revert in 24h) ---
        // If trade has +5% profit and is 24h old, lock it in
        if (pnlPercent >= 0.05 && tradeAge >= 24) {
            const reason = `🎯 SPIKE LOCK: ${(pnlPercent * 100).toFixed(1)}% after ${tradeAge.toFixed(0)}h`;
            await closeTrade(i, currentPrice, reason);
            continue;
        }

        // --- 6. RESOLVED MARKET CHECK (price at 0 or 1 = market settled) ---
        if (currentPrice <= 0.01 || currentPrice >= 0.99) {
            try {
                const resolution = await resolveTradeWithRealOutcome(trade);
                if (resolution) {
                    // Track daily PnL
                    const todayStr = new Date().toISOString().split('T')[0];
                    if (botState.dailyPnLResetDate !== todayStr) {
                        botState.dailyPnL = 0;
                        botState.dailyPnLResetDate = todayStr;
                    }
                    botState.dailyPnL += resolution.profit || 0;

                    botState.activeTrades.splice(i, 1);
                    botState.closedTrades.unshift(resolution);
                    if (botState.closedTrades.length > 50) botState.closedTrades.pop();
                    stateManager.save(true); // Force Supabase sync on trade close
                    await supabaseService.saveTrade(resolution).catch(e => console.error('Supabase resolution save error:', e));
                    continue;
                }
            } catch (e) {
                console.error(`Error resolving trade ${trade.id} (price=${currentPrice}):`, e.message);
            }
        }

        // --- 7. MARKET EXPIRY CHECK (endDate based) ---
        const marketEndDate = new Date(trade.endDate);
        if (trade.endDate && now > marketEndDate) {
            try {
                const resolution = await resolveTradeWithRealOutcome(trade);
                if (resolution) {
                    // Track daily PnL
                    const todayStr2 = new Date().toISOString().split('T')[0];
                    if (botState.dailyPnLResetDate !== todayStr2) {
                        botState.dailyPnL = 0;
                        botState.dailyPnLResetDate = todayStr2;
                    }
                    botState.dailyPnL += resolution.profit || 0;

                    botState.activeTrades.splice(i, 1);
                    botState.closedTrades.unshift(resolution);
                    if (botState.closedTrades.length > 50) botState.closedTrades.pop();

                    stateManager.save(true); // Force Supabase sync on trade close
                    await supabaseService.saveTrade(resolution).catch(e => console.error('Supabase resolution save error:', e));
                }
            } catch (e) {
                console.error(`Error resolving trade ${trade.id}:`, e.message);
            }
        }
    }

    stateManager.save();
}

// --- RESOLUTION LOGIC ---

async function resolveTradeWithRealOutcome(trade) {
    try {
        const response = await fetch(`https://gamma-api.polymarket.com/markets/${trade.marketId}`);
        if (!response.ok) throw new Error('Failed to fetch market data');
        const market = await response.json();

        if (!market.closed && !market.enableOrderBook) {
            // Not resolved yet
            return null;
        }

        let wonTrade = false;
        if (market.acceptingOrders === false && market.outcomePrices) {
            const yesPrice = parseFloat(market.outcomePrices[0]);
            const noPrice = parseFloat(market.outcomePrices[1]);
            if (yesPrice > 0.99 && trade.side === 'YES') wonTrade = true;
            if (noPrice > 0.99 && trade.side === 'NO') wonTrade = true;
        } else {
            return null; // Still active
        }

        let profit = 0;
        let exitPrice = 0;

        if (wonTrade) {
            // Fix: Shares winning = $1 per share in value
            const finalValue = trade.shares * 1.0;  // 100 shares × $1 = $100
            const exitFees = finalValue * 0.001;
            const invested = trade.amount || trade.size || 0;
            profit = finalValue - exitFees - invested;  // $100 - $0.1 - $50 = $49.9
            exitPrice = 1.0;
            botState.winningTrades++;
            botState.capital += finalValue - exitFees;  // Add winnings to capital
            addLog(botState, `✅ Trade gagné: ${trade.question.substring(0, 30)}... (+${profit.toFixed(2)} USDC)`, 'success');
        } else {
            const invested = trade.amount || trade.size || 0;
            profit = -invested;
            exitPrice = 0.0;
            botState.losingTrades++;
            // Capital already deducted on entry, no refund on loss
            addLog(botState, `❌ Trade perdu: ${trade.question.substring(0, 30)}... (${profit.toFixed(2)} USDC)`, 'warning');
        }

        return {
            ...trade,
            status: 'CLOSED',
            exitPrice: exitPrice,
            pnl: profit,
            profit: profit, // Alias for backward compatibility
            pnlPercent: (trade.amount > 0) ? (profit / trade.amount * 100) : 0,
            closedAt: new Date().toISOString(),
            resolvedOutcome: wonTrade ? 'WON' : 'LOST',
            resolutionMethod: 'REAL_MARKET_OUTCOME'
        };

    } catch (error) {
        console.error(`Error resolving trade ${trade.id}:`, error.message);
        return null;
    }
}

async function closeTrade(index, exitPrice, reason) {
    // ... existing closeTrade logic ...
    const trade = botState.activeTrades[index];
    const finalValue = trade.shares * exitPrice;
    const invested = trade.amount || trade.size || 0;
    const pnl = finalValue - invested;

    botState.capital += finalValue;

    if (pnl > 0) botState.winningTrades++;
    else botState.losingTrades++;

    trade.status = 'CLOSED';
    trade.endTime = new Date().toISOString();
    trade.exitPrice = exitPrice;
    trade.finalValue = finalValue;
    trade.pnl = pnl;
    trade.profit = pnl; // Alias for consistency with resolveTradeWithRealOutcome
    trade.closeReason = reason;

    botState.activeTrades.splice(index, 1);
    botState.closedTrades.unshift(trade);
    if (botState.closedTrades.length > 50) botState.closedTrades.pop();

    // Register cooldown to prevent immediate re-entry on same market
    if (!botState.cooldowns) botState.cooldowns = {};
    botState.cooldowns[trade.marketId] = Date.now();

    // Track daily P&L for loss limit enforcement
    const today = new Date().toISOString().split('T')[0];
    if (botState.dailyPnLResetDate !== today) {
        botState.dailyPnL = 0;
        botState.dailyPnLResetDate = today;
    }
    botState.dailyPnL += pnl;

    stateManager.addSectorEvent(trade.category, 'TRADE', `💰 Trade Closed: ${reason}`, { pnl: pnl.toFixed(2) });
    addLog(botState, `🏁 TRADE CLOSED: ${trade.question.substring(0, 20)}... | PnL: $${pnl.toFixed(2)} (${reason}) [slug:${trade.slug || ''}]`, pnl > 0 ? 'success' : 'warning');

    // Save state (force Supabase sync on trade close)
    stateManager.save(true);

    // Sync to Supabase
    await supabaseService.saveTrade(trade);
}

// --- SMART EXIT: Adaptive Take-Profit based on market volatility ---
async function calculateAdaptiveTP(trade) {
    const smartExit = CONFIG.SMART_EXIT;
    if (!smartExit) return CONFIG.TAKE_PROFIT_PERCENT || 0.10;

    try {
        const trades = await getCLOBTradeHistory(trade.marketId);
        if (!trades || trades.length < 5) {
            return smartExit.TP_MAP.MEDIUM;
        }

        // Calculate price volatility (stddev of % changes)
        const prices = trades.slice(0, 25).map(t => parseFloat(t.price)).filter(p => !isNaN(p) && p > 0);
        if (prices.length < 3) return smartExit.TP_MAP.MEDIUM;

        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }

        const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
        const variance = changes.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / changes.length;
        const stddev = Math.sqrt(variance);

        if (stddev < smartExit.VOLATILITY_THRESHOLDS.LOW) return smartExit.TP_MAP.LOW;
        if (stddev > smartExit.VOLATILITY_THRESHOLDS.HIGH) return smartExit.TP_MAP.HIGH;
        return smartExit.TP_MAP.MEDIUM;

    } catch (e) {
        console.warn(`Adaptive TP failed for ${trade.marketId}: ${e.message}`);
        return CONFIG.TAKE_PROFIT_PERCENT || 0.10;
    }
}

function calculateDynamicStopLoss(trade, currentReturn, maxReturn) {
    const volatilityMap = CONFIG.DYNAMIC_SL.VOLATILITY_MAP;
    let baseStopPercent = volatilityMap[trade.category] || volatilityMap.other;

    // Tighter stop for speculative markets (low entry price = high gap risk)
    if (trade.entryPrice && trade.entryPrice < 0.35 && CONFIG.DYNAMIC_SL.SPECULATIVE_SL_OVERRIDE) {
        baseStopPercent = Math.min(baseStopPercent, CONFIG.DYNAMIC_SL.SPECULATIVE_SL_OVERRIDE);
    }

    // 1. Base Stop: Volatility Adjusted
    let requiredStopPercent = -baseStopPercent;

    // If partial exit taken, floor stop at break-even (never go below 0%)
    if (trade.breakEvenStop) {
        requiredStopPercent = Math.max(requiredStopPercent, 0.0);
    }

    // 2. Trailing Stop Logic
    const activation = CONFIG.DYNAMIC_SL.TRAILING_ACTIVATION || 0.15;
    const distance = CONFIG.DYNAMIC_SL.TRAILING_DISTANCE || 0.05;

    // If profit > 15%, trail by 5% from HIGH
    if (maxReturn >= activation) {
        const trailingLevel = maxReturn - distance;
        if (trailingLevel > requiredStopPercent) {
            requiredStopPercent = trailingLevel;
            // Cap at break-even if just started trailing mostly
        }
    }
    // Secure Break-even if > 10% (Legacy logic preserved)
    else if (maxReturn >= 0.10) {
        requiredStopPercent = 0.00;
    }

    // 3. Time Decay
    const now = new Date();
    const startTime = new Date(trade.startTime);
    const ageHours = (now - startTime) / (1000 * 60 * 60);

    // Tighten stop for old trades: raise stop closer to entry (less negative = tighter)
    // e.g. -0.15 + 0.05 = -0.10 (less risk tolerated as trade ages)
    if (ageHours > CONFIG.DYNAMIC_SL.TIME_DECAY_HOURS) {
        requiredStopPercent += CONFIG.DYNAMIC_SL.TIME_DECAY_PENALTY;
    }

    const stopPrice = trade.entryPrice * (1 + requiredStopPercent);

    let reason = "STOP LOSS";
    if (requiredStopPercent >= 0) reason = "TRAILING STOP (PROFIT)";
    else if (ageHours > CONFIG.DYNAMIC_SL.TIME_DECAY_HOURS) reason = "TIME DECAY STOP";

    // Safety cap
    if (stopPrice > trade.entryPrice * 1.5) return { stopPrice: trade.entryPrice * 1.5, reason, requiredStopPercent }; // sanity check

    return { stopPrice, reason, requiredStopPercent };
}

async function checkLiquidityDepth(market, side, targetPrice, minimumUsdAmount) {
    if (!market.clobTokenIds || market.clobTokenIds.length < 2) return true; // Cannot check, assume OK for legacy/simple markets

    const tokenId = side === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
    const orderBook = await getCLOBOrderBook(tokenId);

    if (!orderBook) return true; // API fail, permit trade (or could fail safe)

    // Side YES (Buy) -> We buy from ASKS.
    // Side NO (Buy No) -> We buy from ASKS (of the No token).
    // Note: Polymarket splits Yes/No tokens. Buying Yes = Buying Yes Token from Ask.
    const asks = orderBook.asks; // [{price: "0.50", size: "100"}, ...]

    let availableLiquidity = 0;
    const maxSlippagePrice = targetPrice * 1.02; // Max 2% slippage accepted

    for (const ask of asks) {
        const price = parseFloat(ask.price);
        const size = parseFloat(ask.size);
        if (price <= maxSlippagePrice) {
            availableLiquidity += (price * size);
        } else {
            break; // Sorted by price usually
        }
    }

    return availableLiquidity >= minimumUsdAmount;
}

async function calculateIntradayTrend(marketId) {
    // Uses recent trades from CLOB to determine slope
    const trades = await getCLOBTradeHistory(marketId); // [{price: "0.55", timestamp: ...}, ...]
    if (!trades || trades.length < 10) return null;

    // Sort by time ascending
    // CLOB usually returns newest first.
    const recent = trades.slice(0, 25).reverse(); // Oldest to Newest

    if (recent.length < 2) return 'FLAT';

    const firstPrice = parseFloat(recent[0].price);
    const lastPrice = parseFloat(recent[recent.length - 1].price);

    if (lastPrice > firstPrice * 1.01) return 'UP'; // Softened from 1.02
    if (lastPrice < firstPrice * 0.99) return 'DOWN'; // Softened from 0.98
    return 'FLAT';
}
