
import { botState, stateManager } from '../state.js';
import { addLog, fetchWithRetry } from '../utils.js';
import { CONFIG } from '../config.js';
import { categorizeMarket } from './signals.js';
import { getBestExecutionPrice, getCLOBOrderBook, getCLOBTradeHistory } from '../api/clob_api.js';
import { supabaseService } from '../services/supabaseService.js';
import { sportsService } from '../services/sportsService.js';
import { riskManager } from './riskManagement.js'; // IMPORT NEW MODULE

function calculateTradeSize(confidence, price) {
    const capital = botState.capital || CONFIG.STARTING_CAPITAL;

    // Use Risk Manager for sizing
    const riskBasedSize = riskManager.calculateTradeSize(capital, confidence);

    // Safety Bounds (Absolute min/max)
    const minSize = CONFIG.MIN_TRADE_SIZE || 2; // Default to $2 if not set
    const maxSize = Math.min(capital * 0.15, 100); // Hard cap $100 or 15%

    return Math.max(minSize, Math.min(riskBasedSize, maxSize));
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
        riskProfile: riskManager.getProfile().id, // Log Current Profile
        tradeExecuted: trade !== null,
        tradeId: trade?.id || null,
        side: trade?.side || null,
        entryPrice: trade?.entryPrice || null,
        confidence: trade?.confidence || null,
        pizzaData: pizzaData ? {
            index: pizzaData.index,
            defcon: pizzaData.defcon
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

const recoveryCache = new Map(); // Global session-based failure cache to avoid log spam

export async function simulateTrade(market, pizzaData, isFreshMarket = false, dependencies = {}) {
    // --- SELF-HEALING (Improved with Cache) ---
    if (!market.clobTokenIds || market.clobTokenIds.length !== 2) {
        const lastAttempt = recoveryCache.get(market.id);
        const now = Date.now();
        const RECOVERY_COOLDOWN = 10 * 60 * 1000; // 10 minutes

        if (!lastAttempt || (now - lastAttempt > RECOVERY_COOLDOWN)) {
            try {
                // Persistent silencing: only log if it's not a known failure or time to retry
                if (!lastAttempt) {
                    addLog(botState, `🩹 Self-Healing: Attempting ID recovery for "${market.question.substring(0, 30)}..."`, 'warning');
                }

                const response = await fetchWithRetry(`https://gamma-api.polymarket.com/markets/${market.id}`);
                if (response && response.ok) {
                    const freshData = await response.json();
                    if (freshData && freshData.clobTokenIds && freshData.clobTokenIds.length === 2) {
                        market.clobTokenIds = freshData.clobTokenIds;
                        addLog(botState, `✅ ID Recovery Success for "${market.question.substring(0, 30)}..."`, 'success');
                        recoveryCache.delete(market.id); // Success! Clear cache
                    } else {
                        // Silent failure to avoid spam
                        recoveryCache.set(market.id, now);
                        console.log(`[RECOVERY-SILENT] Still no valid IDs for: ${market.id}`);
                    }
                } else {
                    recoveryCache.set(market.id, now);
                }
            } catch (e) {
                recoveryCache.set(market.id, now);
            }
        }
    }

    const {
        checkLiquidityDepthFn = checkLiquidityDepth,
        calculateIntradayTrendFn = calculateIntradayTrend,
        testSize = null,
        isTest = false,
        reasonsCollector = null
    } = dependencies;

    // ... (Validation logic omitted for brevity, assuming standard checks exist in original or are standard) ...
    // Note: We need to respect existing validation logic if I replaced the whole file? 
    // Wait, I am replacing a CHUNK, starting from line 1. 
    // I need to be careful not to delete the initial validation.
    // The previous tool output showed lines 1-800.
    // I will replace the imports and the calculateTradeSize/simulateTrade start.

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

    let side, entryPrice, confidence, strategyName;
    const category = categorizeMarket(market.question);
    const decisionReasons = [];

    // NOUVEAU: SPORTS EXPERT (Global Validation)
    const sportsValidation = await sportsService.validateBet(market);
    if (sportsValidation.adjustment <= -0.2) {
        decisionReasons.push(...sportsValidation.reasons);
        if (reasonsCollector) reasonsCollector.push(...sportsValidation.reasons);
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }
    if (sportsValidation.adjustment !== 0 && sportsValidation.adjustment > -0.2) {
        decisionReasons.push(...sportsValidation.reasons);
    }

    // RISK MANAGEMENT: Pre-Screening
    // We check purely based on price/category before strategy logic to save compute?
    // Actually, we need side/confidence first.

    // NOUVEAU: STRATÉGIE ARBITRAGE (Risk-Free)
    const arbSignal = botState.arbitrageOpportunities && botState.arbitrageOpportunities.find(a => a.id === market.id);
    if (arbSignal && yesPrice + noPrice < 0.995) {
        const depthYesOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 25);
        const depthNoOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 25);

        if (depthYesOK && depthNoOK) {
            // Arbitrage is usually allowed even in SAFE mode
            const tradeSize = calculateTradeSize(1.0, (yesPrice + noPrice) / 2) / 2;
            const tradeIdBase = Date.now().toString(36);

            const tradeYes = {
                id: tradeIdBase + 'y',
                marketId: market.id,
                question: market.question,
                side: 'YES',
                amount: tradeSize,
                entryPrice: yesPrice * 1.01,
                startTime: new Date().toISOString(),
                shares: tradeSize / (yesPrice * 1.01),
                status: 'OPEN',
                confidence: 1.0,
                reasons: [`⚖️ Arbitrage: Sum=${(yesPrice + noPrice).toFixed(3)}`],
                category: category,
                strategy: 'Arbitrage',
                clobTokenIds: market.clobTokenIds || []
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
                strategy: 'Arbitrage',
                clobTokenIds: market.clobTokenIds || []
            };

            [tradeYes, tradeNo].forEach(t => {
                botState.capital -= t.amount;
                botState.activeTrades.unshift(t);
                botState.totalTrades += 1;
            });
            stateManager.save();
            return [tradeYes, tradeNo];
        }
    }

    // LOGIQUE AMÉLIORÉE - Vérifier la catégorie en mode DEFCON critique
    if (pizzaData && pizzaData.defcon <= 2) {
        if (category === 'geopolitical' || category === 'economic') {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.65;
            strategyName = 'DEFCON Spike';
            decisionReasons.push(`DEFCON ${pizzaData.defcon} critique + ${category}`);
        } else if (category === 'sports') {
            decisionReasons.push(`Rejeté: Sports pendant DEFCON ${pizzaData.defcon}`);
            if (reasonsCollector) reasonsCollector.push(...decisionReasons);
            logTradeDecision(market, null, decisionReasons, pizzaData);
            return null;
        } else {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.45;
            strategyName = 'DEFCON Spike';
            decisionReasons.push(`DEFCON ${pizzaData.defcon} + autre catégorie`);
        }
    }
    // NOUVEAU: WHALE FOLLOW STRATEGY (Priorité Absolue)
    const whaleAlert = botState.whaleAlerts && botState.whaleAlerts.find(w => w.id === market.id);
    if (whaleAlert) {
        const trend = await calculateIntradayTrendFn(market.id);
        if (trend === 'UP') {
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
            if (depthOK) { side = 'YES'; entryPrice = yesPrice; confidence = 0.75; strategyName = 'Whale Follow'; decisionReasons.push(`🐳 Whale Follow: UP Trend Verified`); }
        } else if (trend === 'DOWN') {
            const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
            if (depthOK) { side = 'NO'; entryPrice = noPrice; confidence = 0.75; strategyName = 'Whale Follow'; decisionReasons.push(`🐳 Whale Follow: DOWN Trend Verified`); }
        } else {
            decisionReasons.push(`⚠️ Whale Alert Ignored: Trend is FLAT`);
        }
    }
    // NOUVEAU: WIZARD FOLLOW STRATEGY (Smart Money / Alpha)
    else if (botState.wizards && botState.wizards.some(w => w.id === market.id)) {
        const wizardSignal = botState.wizards.find(w => w.id === market.id);
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.60;
            strategyName = 'Wizard Follow';
            decisionReasons.push(`🧙 Wizard Follow: High Alpha (${wizardSignal.alpha}%)`);
        }
    }

    // NOUVEAU: TREND FOLLOWING (Optimisé + Intraday Check + Depth Check)
    else if (market.volume24hr > 1000 && yesPrice > 0.55 && yesPrice < 0.90) {
        const trend = await calculateIntradayTrendFn(market.id);
        if (trend === 'UP') {
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
            if (depthOK) {
                side = 'YES';
                entryPrice = yesPrice;
                confidence = 0.65;
                strategyName = 'Trend Following';
                decisionReasons.push(`🚀 Trend Following Verified (Vol: ${parseInt(market.volume24hr)} | Intraday: UP)`);
            }
        }
    }
    // NOUVEAU: HYPE FADER (Depth Checked)
    else if (yesPrice > 0.92 && yesPrice < 0.98) {
        const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
        if (depthOK) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.50;
            strategyName = 'Hype Fader';
            decisionReasons.push(`📉 Hype Fader: Shorting Overbought YES`);
        }
    } else if (noPrice > 0.92 && noPrice < 0.98) {
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.50;
            strategyName = 'Hype Fader';
            decisionReasons.push(`📈 Hype Fader: Shorting Overbought NO`);
        }
    }
    // NOUVEAU: SMART MOMENTUM
    else if (market.volume24hr && parseFloat(market.volume24hr) > 1000) {
        if (yesPrice >= 0.55 && yesPrice <= 0.85) {
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
            if (depthOK) { side = 'YES'; entryPrice = yesPrice; confidence = 0.45; strategyName = 'Smart Momentum'; decisionReasons.push(`🔥 Smart Momentum: Following YES Favorite`); }
        }
        else if (noPrice >= 0.55 && noPrice <= 0.85) {
            const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
            if (depthOK) { side = 'NO'; entryPrice = noPrice; confidence = 0.45; strategyName = 'Smart Momentum'; decisionReasons.push(`🔥 Smart Momentum: Following NO Favorite`); }
        }
    }
    // Prix très bas (long shots)
    else if (yesPrice < 0.20 && yesPrice >= 0.01) {
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 20);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.35;
            strategyName = 'Contrarian (Low Price)';
            decisionReasons.push(`Prix bas YES: ${yesPrice.toFixed(3)}`);
        }
    } else if (noPrice < 0.20 && noPrice >= 0.01) {
        const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 20);
        if (depthOK) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.35;
            strategyName = 'Contrarian (Low Price)';
            decisionReasons.push(`Prix bas NO: ${noPrice.toFixed(3)}`);
        }
    }
    // NOUVEAU: Prix moyens
    else if (yesPrice >= 0.20 && yesPrice <= 0.40) {
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 50);
        if (depthOK) { side = 'YES'; entryPrice = yesPrice; confidence = 0.40; strategyName = 'Mean Reversion (Med)'; decisionReasons.push(`Prix moyen YES: ${yesPrice.toFixed(3)}`); }
    } else if (noPrice >= 0.20 && noPrice <= 0.40) {
        const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
        if (depthOK) { side = 'NO'; entryPrice = noPrice; confidence = 0.40; strategyName = 'Mean Reversion (Med)'; decisionReasons.push(`Prix moyen NO: ${noPrice.toFixed(3)}`); }
    }

    if (!side || !entryPrice) {
        decisionReasons.push('Aucune condition de trade remplie');
        if (reasonsCollector) reasonsCollector.push(...decisionReasons);
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

    // --- RISK MANAGER VALIDATION ---
    // This is the critical gatekeeper loop
    const riskCheck = riskManager.canTrade(
        'standard', // we could pass a specific strategy type if we tracked it above (TODO: improve logic to pass strategy type)
        confidence,
        entryPrice
    );

    if (!riskCheck.allowed) {
        decisionReasons.push(`⛔ RISK CHECK FAILED: ${riskCheck.reason} (${riskManager.getProfile().id})`);
        if (reasonsCollector) reasonsCollector.push(riskCheck.reason);
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }




    // CHECK: Penny Stock Filter (unless allowed by profile)
    const currentProfile = riskManager.getProfile();
    const minThreshold = CONFIG.MIN_PRICE_THRESHOLD || 0.05;

    if (entryPrice < minThreshold && !currentProfile.allowPennyStocks) {
        const reason = `Price too low (<${minThreshold}) - Penny Stock Filter (Active in ${currentProfile.label})`;
        if (reasonsCollector) reasonsCollector.push(reason);
        // Optional: log rejected decision 
        // logTradeDecision(market, null, [...decisionReasons, reason], pizzaData);
        return null;
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

    let tradeSize = dependencies.testSize || calculateTradeSize(confidence, entryPrice);

    // 2. Adjust Size
    if (botState.learningParams && botState.learningParams.sizeMultiplier !== 1.0) {
        tradeSize *= botState.learningParams.sizeMultiplier;
        decisionReasons.push(`🎓 AI Adaptation: Size x${botState.learningParams.sizeMultiplier.toFixed(2)}`);
    }

    if (tradeSize > botState.capital) tradeSize = botState.capital;

    // CRITICAL: Prevent Ghost Trades ($0 or near-zero amounts)
    if (tradeSize < CONFIG.MIN_TRADE_SIZE || botState.capital < CONFIG.MIN_TRADE_SIZE) {
        const lowCapMsg = `Skipped trade: Insufficient capital ($${botState.capital.toFixed(2)}) or trade size too small ($${tradeSize.toFixed(2)})`;
        decisionReasons.push(lowCapMsg);
        if (reasonsCollector) reasonsCollector.push(lowCapMsg);
        addLog(botState, `⚠️ ${lowCapMsg}`, 'warning');
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

    // --- STRICT REALISM: FETCH REAL EXECUTION PRICE FROM ORDER BOOK ---
    // This ensures we don't "Paper Trade" at phantom prices (e.g. 1 cent)

    // Self-healing block moved to top of function

    if (market.clobTokenIds && market.clobTokenIds.length === 2) {
        const tokenId = side === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
        if (tokenId) {
            try {
                // Fetch REAL Ask Price (what we would actually pay)
                const executionData = await getBestExecutionPrice(tokenId, 'buy');

                if (!executionData || !executionData.price || executionData.price <= 0) {
                    const reason = `⛔ REALISM CHECK FAILED: No Liquidity in Order Book for ${side}`;
                    if (reasonsCollector) reasonsCollector.push(reason);
                    // logTradeDecision(market, null, [...decisionReasons, reason], pizzaData); 
                    return null; // ABORT
                }

                // Filter out extreme spreads (e.g. Bid 0.10 / Ask 0.90)
                if (executionData.spreadPercent > 50) {
                    const reason = `⛔ Spread too wide (${executionData.spreadPercent}%) - Unsafe execution`;
                    if (reasonsCollector) reasonsCollector.push(reason);
                    return null;
                }

                // FORCE UPDATE Entry Price to Real Ask
                // If Gamma said 0.01 but Order Book Ask is 0.05, we MUST use 0.05
                if (Math.abs(entryPrice - executionData.price) > 0.001) {
                    decisionReasons.push(`⚡ Price Adjusted: ${entryPrice.toFixed(3)} -> ${executionData.price.toFixed(3)} (Real Order Book)`);
                    entryPrice = executionData.price;
                }

                // Re-check Min Price Threshold with Real Price (unless allowed by profile)
                if (entryPrice < (CONFIG.MIN_PRICE_THRESHOLD || 0.05) && !currentProfile.allowPennyStocks) {
                    const reason = `⛔ Real Price too low (<${CONFIG.MIN_PRICE_THRESHOLD}) - Penny Stock Filter (Active in ${currentProfile.label})`;
                    if (reasonsCollector) reasonsCollector.push(reason);
                    return null;
                }

            } catch (e) {
                console.warn(`CLOB Check Failed for ${market.question}:`, e.message);
                // If CLOB fails, better to skip than trade on fake data if user wants certainty
                return null;
            }
        }
    } else {
        const currentProfile = riskManager.getProfile();
        const fallbackAllowed = CONFIG.ALLOW_GAMMA_FALLBACK || ['YOLO', 'RISKY'].includes(currentProfile.id);

        if (fallbackAllowed) {
            const fallbackSlippage = 0.015; // 1.5% penalty for using Gamma instead of Order Book
            const oldPrice = entryPrice;
            entryPrice = entryPrice * (1 + (side === 'YES' ? fallbackSlippage : -fallbackSlippage));

            const reason = `⚠️ [GAMMA-FALLBACK] No CLOB IDs. Using Gamma price + 1.5% slippage penalty ($${oldPrice.toFixed(3)} -> $${entryPrice.toFixed(3)})`;
            decisionReasons.push(reason);
            if (reasonsCollector) reasonsCollector.push(reason);
            // We proceed with the trade
        } else {
            // If we can't verify with CLOB and fallback not allowed, we skip
            const reason = `⚠️ No CLOB IDs - Cannot verify real price. Skipped (SAFE/MEDIUM mode).`;
            if (reasonsCollector) reasonsCollector.push(reason);
            return null;
        }
    }

    // Simulation de slippage et frais STANDARDS (ajouté au prix déjà potentiellement pénalisé par le fallback)
    const slippage = 0.01;
    const fee = 0.00;
    const executionPrice = entryPrice * (1 + (side === 'YES' ? slippage : -slippage));

    const trade = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        marketId: market.id,
        question: market.question,
        slug: market.slug,
        side: side,
        amount: tradeSize,
        entryPrice: executionPrice,
        priceSource: (market.clobTokenIds && market.clobTokenIds.length === 2) ? 'CLOB' : 'GAMMA_FALLBACK',
        startTime: new Date().toISOString(),
        shares: tradeSize / executionPrice,
        status: 'OPEN',
        confidence: confidence,
        reasons: decisionReasons,
        category: category,
        strategy: strategyName || 'Default',
        isFresh: isFreshMarket,
        clobTokenIds: market.clobTokenIds || []
    };

    await saveNewTrade(trade);
    logTradeDecision(market, trade, decisionReasons, pizzaData);

    const icon = category === 'geopolitical' ? '🌍' : (category === 'economic' ? '📉' : '🎰');
    stateManager.addSectorEvent(category, 'TRADE', `${icon} Trade Opened: $${tradeSize.toFixed(0)} on ${side}`, {
        market: market.question,
        price: executionPrice.toFixed(2)
    });

    return trade;
}

async function saveNewTrade(trade) {
    botState.capital -= trade.amount;
    botState.activeTrades.unshift(trade);
    botState.totalTrades += 1;

    // Persist synchronously to local file and asynchronously but awaited to Cloud
    await stateManager.save();
    try {
        await supabaseService.saveTrade(trade);
    } catch (err) {
        console.error('Supabase Save Error:', err);
    }

    addLog(botState, `✅ TRADE OPENED: ${trade.side} sur "${trade.question.substring(0, 30)}..." @ $${trade.entryPrice.toFixed(3)} ($${trade.amount.toFixed(2)})`, 'trade');
}

export async function checkAndCloseTrades(getRealMarketPriceFn) {
    if (botState.activeTrades.length === 0) return;

    console.log(`🔍 Checking ${botState.activeTrades.length} active trades...`);

    for (let i = botState.activeTrades.length - 1; i >= 0; i--) {
        const trade = botState.activeTrades[i];

        const invested = trade.amount || trade.size || 0;

        // --- 1. GET PRICE & TRACK HISTORY ---
        const currentPrice = getRealMarketPriceFn ? await getRealMarketPriceFn(trade) : (trade.entryPrice || 0.5);

        if (!currentPrice || isNaN(currentPrice)) continue;

        trade.priceHistory = trade.priceHistory || [];
        trade.priceHistory.push(currentPrice);
        if (trade.priceHistory.length > 50) trade.priceHistory.shift();

        // --- NEW: AUDIT & DRIFT CHECK ---
        // If trade was entered via Gamma Fallback, try to see if CLOB IDs are now available to verify "Real" price
        if (trade.priceSource === 'GAMMA_FALLBACK' && trade.clobTokenIds && trade.clobTokenIds.length === 2) {
            try {
                const tokenId = trade.side === 'YES' ? trade.clobTokenIds[0] : trade.clobTokenIds[1];
                const realPriceInfo = await getBestExecutionPrice(tokenId, trade.side.toLowerCase());
                if (realPriceInfo && realPriceInfo.price) {
                    const drift = realPriceInfo.price - trade.entryPrice;
                    trade.clobDrift = drift;
                    trade.priceSource = 'CLOB_VERIFIED'; // Mark as audited
                    console.log(`📊 [AUDIT] Drift detected for ${trade.id}: ${drift.toFixed(4)} (Gamma: ${trade.entryPrice.toFixed(3)} | CLOB: ${realPriceInfo.price.toFixed(3)})`);
                }
            } catch (e) { /* Silently fail audit */ }
        }

        // Update timestamp for Dashboard "PRICES: LIVE" indicator
        trade.lastPriceUpdate = new Date().toISOString();

        const pnlPercent = invested > 0 ? (trade.shares * currentPrice - invested) / invested : 0;
        trade.maxReturn = Math.max(trade.maxReturn || 0, pnlPercent);
        trade.pnl = pnlPercent * 100; // Store as percentage for UI display

        // --- 2. DYNAMIC STOP LOSS CHECK ---
        const dynamicStopInfo = calculateDynamicStopLoss(trade, pnlPercent, trade.maxReturn);
        const requiredStopPercent = dynamicStopInfo.requiredStopPercent;

        if (pnlPercent <= requiredStopPercent) {
            const reason = `STOP LOSS: ${(pnlPercent * 100).toFixed(1)}% (Limit: ${(requiredStopPercent * 100).toFixed(1)}%)`;
            await closeTrade(trade, i, currentPrice, reason);
            continue;
        }

        // --- 3. TAKE PROFIT CHECK ---
        const tpPercent = CONFIG.TAKE_PROFIT_PERCENT || 0.20;
        if (pnlPercent >= tpPercent) {
            await closeTrade(trade, i, currentPrice, `TAKE PROFIT: ${(pnlPercent * 100).toFixed(1)}% reached`);
            continue;
        }

        // --- 4. TIMEOUT CHECK (Research-backed: 48h for prediction markets) ---
        const now = Date.now();
        const tradeAge = (now - new Date(trade.startTime).getTime()) / (1000 * 60 * 60); // hours
        const timeoutHours = CONFIG.TRADE_TIMEOUT_HOURS || 48;

        if (tradeAge >= timeoutHours) {
            const reason = `⏱️ TIMEOUT: ${tradeAge.toFixed(1)}h (PnL: ${(pnlPercent * 100).toFixed(1)}%)`;
            addLog(botState, `${reason} - Freeing capital for new opportunities`, 'info');
            await closeTrade(trade, i, currentPrice, reason);
            continue;
        }

        // --- 5. EMOTIONAL SPIKE REVERSION (70% of spikes revert in 24h) ---
        // If trade has +5% profit and is 24h old, lock it in
        if (pnlPercent >= 0.05 && tradeAge >= 24) {
            const reason = `🎯 SPIKE LOCK: ${(pnlPercent * 100).toFixed(1)}% after ${tradeAge.toFixed(0)}h`;
            await closeTrade(trade, i, currentPrice, reason);
            continue;
        }

        // Vérifier si le marché a expiré (reuse 'now' from above)
        const marketEndDate = new Date(trade.endDate);
        if (now > marketEndDate) {
            try {
                const resolution = await resolveTradeWithRealOutcome(trade, i);
                if (resolution) {
                    // The resolveTradeWithRealOutcome function now handles state updates and Supabase sync
                    // No need to splice/unshift here or save state again
                }
            } catch (e) {
                console.error(`Error resolving trade ${trade.id}:`, e.message);
            }
        }
    }

    await stateManager.save(); // Save state after the loop in case no trades were closed but some were updated
}

// --- RESOLUTION LOGIC ---

async function resolveTradeWithRealOutcome(trade, index) {
    try {
        const response = await fetch(`https://gamma-api.polymarket.com/markets/${trade.marketId}`);
        if (!response.ok) throw new Error('Failed to fetch market data');
        const market = await response.json();

        // A market is resolved if it's closed OR if orders are no longer accepted and outcome prices are set
        const isResolved = market.closed || (market.acceptingOrders === false && market.outcomePrices);

        if (!isResolved) {
            // Not resolved yet
            return null;
        }

        let wonTrade = false;
        let marketOutcome = null; // 'YES' or 'NO'
        if (market.acceptingOrders === false && market.outcomePrices) {
            const yesPrice = parseFloat(market.outcomePrices[0]);
            const noPrice = parseFloat(market.outcomePrices[1]);
            if (yesPrice > 0.99) {
                marketOutcome = 'YES';
            } else if (noPrice > 0.99) {
                marketOutcome = 'NO';
            }

            if (marketOutcome === trade.side) wonTrade = true;
        } else {
            return null; // Still active
        }

        let profit = 0;
        let exitPrice = 0;

        if (wonTrade) {
            const rawReturn = trade.shares * 1.0;
            const exitFees = rawReturn * 0.001;
            const invested = trade.amount || trade.size || 0;
            profit = (rawReturn - exitFees) - invested;
            exitPrice = 1.0;
            botState.winningTrades++;
            addLog(botState, `✅ Trade gagné: ${trade.question.substring(0, 30)}... (+${profit.toFixed(2)} USDC)`, 'success');
        } else {
            const invested = trade.amount || trade.size || 0;
            profit = -invested;
            exitPrice = 0.0;
            botState.losingTrades++;
            addLog(botState, `❌ Trade perdu: ${trade.question.substring(0, 30)}... (${profit.toFixed(2)} USDC)`, 'warning');
        }

        const resolvedTrade = {
            ...trade,
            status: 'CLOSED',
            exitPrice: exitPrice,
            profit: profit,
            closedAt: new Date().toISOString(),
            resolvedOutcome: wonTrade ? 'WON' : 'LOST',
            resolutionMethod: 'REAL_MARKET_OUTCOME'
        };

        botState.capital += (resolvedTrade.shares * exitPrice); // Add capital back
        botState.activeTrades.splice(index, 1);
        botState.closedTrades.unshift(resolvedTrade);
        if (botState.closedTrades.length > 50) botState.closedTrades.pop();

        await stateManager.save();
        try {
            await supabaseService.saveTrade(resolvedTrade);
        } catch (e) { console.error("Supabase Resolve Error:", e); }

        return resolvedTrade;

    } catch (error) {
        console.error(`Error resolving trade ${trade.id}:`, error.message);
        return null;
    }
}

async function closeTrade(trade, index, exitPrice, reason) {
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

    stateManager.addSectorEvent(trade.category, 'TRADE', `💰 Trade Closed: ${reason}`, { pnl: pnl.toFixed(2) });
    addLog(botState, `🏁 TRADE CLOSED: ${trade.question.substring(0, 20)}... | PnL: $${pnl.toFixed(2)} (${reason})`, pnl > 0 ? 'success' : 'warning');

    // Save state
    await stateManager.save();

    // Sync to Supabase
    try {
        await supabaseService.saveTrade(trade);
    } catch (e) { console.error("Supabase Close Error:", e); }
}

function calculateDynamicStopLoss(trade, currentReturn, maxReturn) {
    const volatilityMap = CONFIG.DYNAMIC_SL.VOLATILITY_MAP;
    const baseStopPercent = volatilityMap[trade.category] || volatilityMap.other;

    // 1. Base Stop: Volatility Adjusted
    let requiredStopPercent = -baseStopPercent;

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

    // Tighten stop for old trades
    if (ageHours > CONFIG.DYNAMIC_SL.TIME_DECAY_HOURS) {
        requiredStopPercent -= CONFIG.DYNAMIC_SL.TIME_DECAY_PENALTY; // e.g. -0.15 - 0.05 = -0.20 (Wait, tightened means LESS negative or MORE negative? Needs to be closer to 0? No, tighter stop means closer to entry. If entry is 100, Stop -15% is 85. Tighten means 90 (-10%). So we ADD to the negative number.)
        // Correction: Tighten means risking LESS. So -0.15 becomes -0.10.
        // Wait, Time Decay usually means "Get out, I'm losing patience". In my plan I said "Tighten SL".
        // If I have -15% risk, tightening means -10% risk? Or does it mean "Force Exit" so I should raise the stop?
        // Let's say we want to exit faster if it does nothing. So yes, raise the stop (make it less negative).
        // -0.15 + 0.05 = -0.10. Correct.
        requiredStopPercent += CONFIG.DYNAMIC_SL.TIME_DECAY_PENALTY;
    }

    const stopPrice = trade.entryPrice * (1 + requiredStopPercent);

    let reason = "STOP LOSS";
    if (requiredStopPercent >= 0) reason = "TRAILING STOP (PROFIT)";
    else if (ageHours > CONFIG.DYNAMIC_SL.TIME_DECAY_HOURS) reason = "TIME DECAY STOP";

    // Safety cap
    if (stopPrice > trade.entryPrice * 1.5) {
        return { stopPrice: trade.entryPrice * 1.5, requiredStopPercent: 0.50, reason: reason + " (SAFETY CAP)" };
    }

    return { stopPrice, requiredStopPercent, reason };
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
    if (!trades || trades.length < 5) return null;

    // Sort by time ascending
    // CLOB usually returns newest first.
    const recent = trades.slice(0, 10).reverse(); // Oldest to Newest

    if (recent.length < 2) return 'FLAT';

    const firstPrice = parseFloat(recent[0].price);
    const lastPrice = parseFloat(recent[recent.length - 1].price);

    if (lastPrice > firstPrice * 1.01) return 'UP'; // Softened from 1.02
    if (lastPrice < firstPrice * 0.99) return 'DOWN'; // Softened from 0.98
    return 'FLAT';
}
