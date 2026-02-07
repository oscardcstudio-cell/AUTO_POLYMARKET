
import { botState, stateManager } from '../state.js';
import { addLog } from '../utils.js';
import { CONFIG } from '../config.js';
import { categorizeMarket } from './signals.js';
import { getBestExecutionPrice } from '../api/clob_api.js';

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

export function simulateTrade(market, pizzaData, isFreshMarket = false) {
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
    // Prix très bas (long shots)
    else if (yesPrice < 0.15 && yesPrice >= 0.01) {
        side = 'YES';
        entryPrice = yesPrice;
        confidence = 0.25;
        decisionReasons.push(`Prix bas YES: ${yesPrice.toFixed(3)}`);
    } else if (noPrice < 0.2 && noPrice >= 0.01) {
        side = 'NO';
        entryPrice = noPrice;
        confidence = 0.35;
        decisionReasons.push(`Prix bas NO: ${noPrice.toFixed(3)}`);
    }
    // NOUVEAU: Prix moyens 
    else if (yesPrice >= 0.20 && yesPrice <= 0.40) {
        side = 'YES';
        entryPrice = yesPrice;
        confidence = 0.40;
        decisionReasons.push(`Prix moyen YES: ${yesPrice.toFixed(3)}`);
    } else if (noPrice >= 0.20 && noPrice <= 0.40) {
        side = 'NO';
        entryPrice = noPrice;
        confidence = 0.40;
        decisionReasons.push(`Prix moyen NO: ${noPrice.toFixed(3)}`);
    }
    // NOUVEAU: TREND FOLLOWING (Optimisé: Vol > 2000, Price > 0.55)
    else if (market.volume24hr > 2000 && yesPrice > 0.55 && yesPrice < 0.90) {
        side = 'YES';
        entryPrice = yesPrice;
        confidence = 0.60;
        decisionReasons.push(`🚀 Trend Following (Vol: ${parseInt(market.volume24hr)} | Price: ${yesPrice.toFixed(2)})`);
    }
    // NOUVEAU: HYPE FADER (MEAN REVERSION)
    else if (yesPrice > 0.92 && yesPrice < 0.98) {
        side = 'NO';
        entryPrice = noPrice;
        confidence = 0.50;
        decisionReasons.push(`📉 Hype Fader: Shorting Overbought (Price: ${yesPrice.toFixed(2)})`);
    }
    // NOUVEAU: SMART MOMENTUM (Volume > 1000)
    else if (market.volume24hr && parseFloat(market.volume24hr) > 1000) {
        if (yesPrice >= 0.55 && yesPrice <= 0.85) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.45;
            decisionReasons.push(`🔥 Smart Momentum: Following YES Favorite (Vol: ${market.volume24hr})`);
        }
        else if (noPrice >= 0.55 && noPrice <= 0.85) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.45;
            decisionReasons.push(`🔥 Smart Momentum: Following NO Favorite (Vol: ${market.volume24hr})`);
        }
        else {
            if (yesPrice < noPrice) {
                side = 'YES';
                entryPrice = yesPrice;
                confidence = 0.35;
                decisionReasons.push(`Contrarian Momentum - Betting Cheap YES`);
            } else {
                side = 'NO';
                entryPrice = noPrice;
                confidence = 0.35;
                decisionReasons.push(`Contrarian Momentum - Betting Cheap NO`);
            }
        }
    }
    else {
        decisionReasons.push('Aucune condition de trade remplie');
        logTradeDecision(market, null, decisionReasons, pizzaData);
        return null;
    }

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
        isFresh: isFreshMarket
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
            currentPrice = await getRealMarketPriceFn(trade.marketId, trade.side);
        } else {
            // Fallback mock price logic (simplified)
            currentPrice = trade.entryPrice || 0.50;
        }

        if (!currentPrice || isNaN(currentPrice)) {
            currentPrice = 0.50;
            console.warn(`⚠️ Warning: Using fallback price 0.50 for trade ${trade.question}`);
        }

        const currentValue = trade.shares * currentPrice;
        const invested = trade.amount || trade.size || 0;
        const pnl = currentValue - invested;
        const pnlPercent = invested > 0 ? pnl / invested : 0;

        const durationHours = (new Date() - new Date(trade.startTime)) / (1000 * 60 * 60);

        let closeReason = null;

        if (pnlPercent >= CONFIG.TAKE_PROFIT_PERCENT) closeReason = `Take Profit (+${(pnlPercent * 100).toFixed(1)}%)`;
        else if (pnlPercent <= -CONFIG.STOP_LOSS_PERCENT) closeReason = `Stop Loss (${(pnlPercent * 100).toFixed(1)}%)`;
        else if (durationHours > 48 && pnlPercent < 0) closeReason = "Stale Trade (>48h)";
        else if (currentPrice > 0.98) closeReason = "Max Price Reached";

        if (closeReason) {
            await closeTrade(i, currentPrice, closeReason);
        }
    }

    // Update active trade values derived in realtime usually, but here we update state
    stateManager.save();
}

async function closeTrade(index, exitPrice, reason) {
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
}
