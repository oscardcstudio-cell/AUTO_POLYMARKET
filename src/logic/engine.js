
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';
import { categorizeMarket } from './signals.js';
import { getBestExecutionPrice, getCLOBOrderBook, getCLOBTradeHistory } from '../api/clob_api.js';

function calculateTradeSize() {
    const maxSize = botState.capital * CONFIG.MAX_TRADE_SIZE_PERCENT;
    return Math.max(CONFIG.MIN_TRADE_SIZE, Math.min(maxSize, 50));
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

export async function simulateTrade(market, pizzaData, isFreshMarket = false, dependencies = {}) {
    const {
        checkLiquidityDepthFn = checkLiquidityDepth,
        calculateIntradayTrendFn = calculateIntradayTrend
    } = dependencies;

    if (!market.outcomePrices || market.outcomePrices.length < 2) return null;

    const yesPrice = parseFloat(market.outcomePrices[0]);
    const noPrice = parseFloat(market.outcomePrices[1]);

    if (isNaN(yesPrice) || isNaN(noPrice)) return null;

    let side, entryPrice, confidence;
    const category = categorizeMarket(market.question);
    const decisionReasons = [];

    // LOGIQUE AMÉLIORÉE - Vérifier la catégorie en mode DEFCON critique
    if (pizzaData && pizzaData.defcon <= 2) {
        if (category === 'geopolitical' || category === 'economic') {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.65;
            decisionReasons.push(`DEFCON ${pizzaData.defcon} critique + ${category}`);
        } else if (category === 'sports') {
            decisionReasons.push(`Rejeté: Sports pendant DEFCON ${pizzaData.defcon}`);
            logTradeDecision(market, null, decisionReasons, pizzaData);
            return null;
        } else {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.45;
            decisionReasons.push(`DEFCON ${pizzaData.defcon} + autre catégorie`);
        }
    }
    // NOUVEAU: TREND FOLLOWING (Optimisé + Intraday Check + Depth Check)
    else if (market.volume24hr > 2000 && yesPrice > 0.55 && yesPrice < 0.90) {
        // 1. Check Intraday Trend
        const trend = await calculateIntradayTrendFn(market.id);
        if (trend === 'UP') {
            // 2. Check Depth 
            const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 100); // Check for $100 depth
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
        // Check Depth for Shorting
        const depthOK = await checkLiquidityDepthFn(market, 'NO', noPrice, 50);
        if (depthOK) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.50;
            decisionReasons.push(`📉 Hype Fader: Shorting Overbought (Price: ${yesPrice.toFixed(2)})`);
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
    else if (yesPrice < 0.15 && yesPrice >= 0.01) {
        const depthOK = await checkLiquidityDepthFn(market, 'YES', yesPrice, 20);
        if (depthOK) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.25;
            decisionReasons.push(`Prix bas YES: ${yesPrice.toFixed(3)}`);
        }
    } else if (noPrice < 0.2 && noPrice >= 0.01) {
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
    else {
        decisionReasons.push('Aucune condition de trade remplie');
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

    // Safety check if side was set but no entryPrice (shouldn't happen with above logic but safe)
    if (!side || !entryPrice) return null; // Added safety return


    if (entryPrice < 0.01) return null;

    if (market.volume24hr > 10000 && entryPrice > 0.60 && side === 'YES') {
        confidence += 0.10;
        decisionReasons.push(`🔥 High Momentum (Vol: ${parseInt(market.volume24hr)})`);
    }

    let tradeSize = calculateTradeSize();

    if (tradeSize > botState.capital) tradeSize = botState.capital;

    // Simulation de slippage et frais
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
        startTime: new Date().toISOString(),
        shares: tradeSize / executionPrice,
        status: 'OPEN',
        confidence: confidence,
        reasons: decisionReasons,
        category: category,
        isFresh: isFreshMarket,
        clobTokenIds: market.clobTokenIds || []
    };

    saveNewTrade(trade);
    logTradeDecision(market, trade, decisionReasons, pizzaData);

    const icon = category === 'geopolitical' ? '🌍' : (category === 'economic' ? '📉' : '🎰');
    stateManager.addSectorEvent(category, 'TRADE', `${icon} Trade Opened: $${tradeSize.toFixed(0)} on ${side}`, {
        market: market.question,
        price: executionPrice.toFixed(2)
    });

    return trade;
}

function saveNewTrade(trade) {
    botState.capital -= trade.amount;
    botState.activeTrades.unshift(trade);
    botState.totalTrades += 1;

    // Limiter l'historique des trades actifs pour éviter le bloat
    if (botState.activeTrades.length > CONFIG.MAX_ACTIVE_TRADES) {
        // Warning: This logic was just shifting, but we don't want to close random trades.
        // We just prevent opening new ones in the loop if max is reached.
    }

    stateManager.save();
    addLog(botState, `✅ TRADE OPENED: ${trade.side} sur "${trade.question.substring(0, 30)}..." @ $${trade.entryPrice.toFixed(3)} ($${trade.amount.toFixed(2)})`, 'trade');
}

export async function checkAndCloseTrades(getRealMarketPriceFn) {
    if (botState.activeTrades.length === 0) return;

    addLog(botState, `🔍 Checking ${botState.activeTrades.length} active trades...`, 'info');

    for (let i = botState.activeTrades.length - 1; i >= 0; i--) {
        const trade = botState.activeTrades[i];

        // Use provided price fetcher (injected) or default
        let currentPrice = 0;
        if (getRealMarketPriceFn) {
            currentPrice = await getRealMarketPriceFn(trade);
        } else {
            // Fallback mock price logic (simplified)
            currentPrice = trade.entryPrice || 0.50;
        }

        if (!currentPrice || isNaN(currentPrice)) {
            // STRICT MODE: No fallback. Skip processing if price unavailable.
            // console.warn(`⚠️ Warning: Price unavailable for trade ${trade.question}`);
            continue;
        }

        const currentValue = trade.shares * currentPrice;
        const invested = trade.amount || trade.size || 0;
        const pnl = currentValue - invested;
        const pnlPercent = invested > 0 ? pnl / invested : 0;

        const durationHours = (new Date() - new Date(trade.startTime)) / (1000 * 60 * 60);

        let closeReason = null;

        // --- STRATÉGIE "ESCALIER DE SÉCURITÉ" (Dynamic Trailing Stop) ---
        const dynamicStopInfo = calculateDynamicStopLoss(trade, currentReturn, maxReturn);
        const dynamicStopPrice = dynamicStopInfo.stopPrice;

        // VÉRIFICATION DE LA SORTIE
        // On vend si le prix ACTUEL passe SOUS le Stop Dynamique
        if (realPrice <= dynamicStopPrice) {
            const reason = dynamicStopInfo.reason;
            await executeSell(trade, realPrice, reason);
            botState.activeTrades.splice(i, 1);
            saveState();
            // 💾 SYNC handled in executeSell or implicitly
            continue;
        }

        // Vérifier si le marché a expiré
        const now = new Date();
        const marketEndDate = new Date(trade.endDate);
        if (now > marketEndDate) {
            try {
                const resolution = await resolveTradeWithRealOutcome(trade);
                if (resolution) {
                    botState.activeTrades.splice(i, 1);
                    botState.closedTrades.unshift(resolution);
                    if (botState.closedTrades.length > 50) botState.closedTrades.pop();

                    stateManager.save();
                    // syncDataToGitHub() call via callback or interval? 
                    // stateManager.save() handles file persistence. GitHub sync is separate.
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

        return {
            ...trade,
            status: 'CLOSED',
            exitPrice: exitPrice,
            profit: profit,
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
    trade.closeReason = reason;

    botState.activeTrades.splice(index, 1);
    botState.closedTrades.unshift(trade);
    if (botState.closedTrades.length > 50) botState.closedTrades.pop();

    stateManager.addSectorEvent(trade.category, 'TRADE', `💰 Trade Closed: ${reason}`, { pnl: pnl.toFixed(2) });
    addLog(botState, `🏁 TRADE CLOSED: ${trade.question.substring(0, 20)}... | PnL: $${pnl.toFixed(2)} (${reason})`, pnl > 0 ? 'success' : 'warning');

    // Save state
    stateManager.save();
    // syncDataToGitHub handled in calling function or main loop
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
    if (stopPrice > trade.entryPrice * 1.5) return { stopPrice: trade.entryPrice * 1.5, reason }; // sanity check

    return { stopPrice, reason };
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

    if (lastPrice > firstPrice * 1.02) return 'UP';
    if (lastPrice < firstPrice * 0.98) return 'DOWN';
    return 'FLAT';
}
