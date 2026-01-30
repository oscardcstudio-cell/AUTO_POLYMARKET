/**
 * POLYMARKET SIMULATION BOT - Version avec portefeuille
 * Simule des trades avec un capital de départ
 */

import fs from 'fs';
import path from 'path';

// Configuration
const CONFIG = {
    STARTING_CAPITAL: 1000, // Capital de départ en USDC
    POLL_INTERVAL_MINUTES: 1, // Vérifier toutes les 1 minute pour plus d'action
    DEFCON_THRESHOLD: 5, // Très permissif pour avoir beaucoup de trades
    MIN_TRADE_SIZE: 10, // Minimum 10 USDC par trade
    MAX_TRADE_SIZE_PERCENT: 0.05, // Maximum 5% du capital par trade
    KEYWORDS: ['Pentagon', 'Israel', 'Iran', 'Hezbollah', 'War', 'Strike', 'Attack', 'Military', 'Trump', 'Conflict', 'Ukraine', 'Russia', 'China', 'Taiwan'],
    DATA_FILE: 'bot_data.json'
};

// État du bot
let botState = {
    startTime: new Date().toISOString(),
    capital: CONFIG.STARTING_CAPITAL,
    startingCapital: CONFIG.STARTING_CAPITAL,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    activeTrades: [],
    closedTrades: [],
    lastPizzaData: null,
    lastUpdate: new Date().toISOString()
};

/**
 * Sauvegarde l'état dans un fichier JSON
 */
function saveState() {
    try {
        const data = {
            ...botState,
            profit: botState.capital - botState.startingCapital,
            profitPercent: ((botState.capital - botState.startingCapital) / botState.startingCapital * 100).toFixed(2)
        };
        fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Erreur sauvegarde:', error.message);
    }
}

/**
 * Charge l'état depuis le fichier
 */
function loadState() {
    try {
        if (fs.existsSync(CONFIG.DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.DATA_FILE, 'utf8'));
            botState = { ...botState, ...data };
            console.log('📂 État chargé depuis le fichier');
        }
    } catch (error) {
        console.error('❌ Erreur chargement:', error.message);
    }
}

/**
 * Récupère les données PizzINT
 */
async function getPizzaData() {
    try {
        const response = await fetch('https://www.pizzint.watch/api/dashboard-data', {
            headers: { 'Referer': 'https://www.pizzint.watch/' }
        });
        const data = await response.json();

        if (data && data.success) {
            return {
                index: data.overall_index,
                defcon: data.defcon_level,
                timestamp: new Date().toISOString()
            };
        }
    } catch (error) {
        console.error('❌ Erreur PizzINT:', error.message);
    }
    return null;
}

/**
 * Récupère les marchés Polymarket pertinents
 */
async function getRelevantMarkets() {
    try {
        const response = await fetch(
            'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100'
        );
        const markets = await response.json();

        if (!Array.isArray(markets)) return [];

        // Filtre les marchés géopolitiques avec bonne liquidité
        return markets.filter(m => {
            const text = (m.question + ' ' + (m.description || '')).toLowerCase();
            const hasKeyword = CONFIG.KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
            const hasLiquidity = parseFloat(m.liquidityNum || 0) > 100;
            return hasKeyword && hasLiquidity;
        }).slice(0, 20);

    } catch (error) {
        console.error('❌ Erreur Polymarket:', error.message);
        return [];
    }
}

/**
 * Calcule la taille du trade basée sur le capital disponible
 */
function calculateTradeSize() {
    const maxSize = botState.capital * CONFIG.MAX_TRADE_SIZE_PERCENT;
    return Math.max(CONFIG.MIN_TRADE_SIZE, Math.min(maxSize, 50)); // Max 50 USDC par trade
}

/**
 * Simule un trade
 */
function simulateTrade(market, pizzaData) {
    const prices = JSON.parse(market.outcomePrices);
    const yesPrice = parseFloat(prices[0]);
    const noPrice = parseFloat(prices[1]);

    // Logique de trading basée sur DEFCON et prix
    let side, entryPrice, confidence;

    if (pizzaData.defcon <= 3) {
        // DEFCON élevé = tension monte
        side = 'YES';
        entryPrice = yesPrice;
        confidence = (4 - pizzaData.defcon) * 0.3; // Plus le DEFCON est bas, plus on est confiant
    } else {
        // DEFCON normal = chercher des opportunités sous-évaluées
        if (yesPrice < 0.3) {
            side = 'YES';
            entryPrice = yesPrice;
            confidence = 0.4;
        } else if (noPrice < 0.3) {
            side = 'NO';
            entryPrice = noPrice;
            confidence = 0.4;
        } else {
            return null; // Pas d'opportunité claire
        }
    }

    const tradeSize = calculateTradeSize();

    // Vérifier qu'on a assez de capital
    if (tradeSize > botState.capital) {
        console.log('⚠️  Capital insuffisant pour trader');
        return null;
    }

    const trade = {
        id: `TRADE_${Date.now()}`,
        marketId: market.id,
        question: market.question,
        side: side,
        entryPrice: entryPrice,
        size: tradeSize,
        shares: tradeSize / entryPrice, // Nombre de parts achetées
        timestamp: new Date().toISOString(),
        endDate: market.endDateIso,
        pizzaIndex: pizzaData.index,
        defcon: pizzaData.defcon,
        confidence: confidence,
        status: 'OPEN'
    };

    botState.activeTrades.push(trade);
    botState.totalTrades++;
    botState.capital -= tradeSize; // Déduire le capital investi

    console.log(`\n💰 NOUVEAU TRADE #${botState.totalTrades}`);
    console.log(`   Question: ${market.question.substring(0, 80)}...`);
    console.log(`   Side: ${side} @ ${entryPrice.toFixed(3)}`);
    console.log(`   Taille: ${tradeSize.toFixed(2)} USDC (${trade.shares.toFixed(2)} parts)`);
    console.log(`   Confiance: ${(confidence * 100).toFixed(0)}%`);
    console.log(`   Capital restant: ${botState.capital.toFixed(2)} USDC`);

    saveState();
    return trade;
}

/**
 * Simule la résolution d'un trade (pour tester)
 */
function simulateTradeResolution(trade) {
    // Simuler un résultat aléatoire pondéré par la confiance
    const random = Math.random();
    const wins = random < (0.5 + trade.confidence);

    let exitPrice, profit;

    if (wins) {
        // Gagné = prix monte vers 1.0
        exitPrice = Math.min(0.95, trade.entryPrice + Math.random() * (1 - trade.entryPrice));
        profit = trade.shares * exitPrice - trade.size;
        botState.winningTrades++;
    } else {
        // Perdu = prix baisse
        exitPrice = Math.max(0.05, trade.entryPrice - Math.random() * trade.entryPrice * 0.5);
        profit = trade.shares * exitPrice - trade.size;
        botState.losingTrades++;
    }

    trade.status = 'CLOSED';
    trade.exitPrice = exitPrice;
    trade.profit = profit;
    trade.closedAt = new Date().toISOString();

    botState.capital += (trade.size + profit); // Récupérer l'investissement + profit/perte

    console.log(`\n${wins ? '✅' : '❌'} TRADE FERMÉ: ${trade.question.substring(0, 60)}...`);
    console.log(`   ${trade.side} ${trade.entryPrice.toFixed(3)} → ${exitPrice.toFixed(3)}`);
    console.log(`   Profit: ${profit > 0 ? '+' : ''}${profit.toFixed(2)} USDC`);
    console.log(`   Capital total: ${botState.capital.toFixed(2)} USDC`);

    return trade;
}

/**
 * Vérifie et clôture les trades (simulation)
 */
async function checkAndCloseTrades() {
    // Pour la simulation, on ferme aléatoirement des trades qui ont plus de 2 minutes
    const now = new Date();

    for (let i = botState.activeTrades.length - 1; i >= 0; i--) {
        const trade = botState.activeTrades[i];
        const tradeAge = (now - new Date(trade.timestamp)) / 1000 / 60; // en minutes

        // 40% de chance de fermer un trade qui a plus de 2 minutes
        if (tradeAge > 2 && Math.random() < 0.4) {
            const closedTrade = simulateTradeResolution(trade);
            botState.closedTrades.unshift(closedTrade); // Ajouter au début
            botState.activeTrades.splice(i, 1);

            // Garder seulement les 50 derniers trades fermés
            if (botState.closedTrades.length > 50) {
                botState.closedTrades = botState.closedTrades.slice(0, 50);
            }

            saveState();
        }
    }
}

/**
 * Affiche le statut du bot
 */
function displayStatus() {
    const profit = botState.capital - botState.startingCapital;
    const profitPercent = (profit / botState.startingCapital * 100);
    const winRate = botState.totalTrades > 0 ? (botState.winningTrades / (botState.winningTrades + botState.losingTrades) * 100) : 0;

    console.log('\n' + '='.repeat(80));
    console.log('📊 STATUT DU BOT - Simulation avec Capital');
    console.log('='.repeat(80));
    console.log(`⏰ Démarré: ${new Date(botState.startTime).toLocaleString('fr-FR')}`);
    console.log(`💰 Capital: ${botState.capital.toFixed(2)} USDC (Départ: ${botState.startingCapital} USDC)`);
    console.log(`📈 Profit: ${profit > 0 ? '+' : ''}${profit.toFixed(2)} USDC (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
    console.log(`📊 Trades: ${botState.totalTrades} total | ${botState.activeTrades.length} actifs | ${botState.closedTrades.length} fermés`);
    console.log(`🎯 Win Rate: ${winRate.toFixed(1)}% (${botState.winningTrades}W / ${botState.losingTrades}L)`);

    if (botState.lastPizzaData) {
        console.log(`\n🍕 PizzINT: Index ${botState.lastPizzaData.index} | DEFCON ${botState.lastPizzaData.defcon}`);
    }

    if (botState.activeTrades.length > 0) {
        console.log(`\n🔥 Trades actifs (${botState.activeTrades.length}):`);
        botState.activeTrades.slice(0, 5).forEach((t, i) => {
            const age = Math.floor((new Date() - new Date(t.timestamp)) / 1000 / 60);
            console.log(`   ${i + 1}. ${t.side} @ ${t.entryPrice.toFixed(3)} | ${t.size.toFixed(0)} USDC | ${age}min`);
            console.log(`      ${t.question.substring(0, 70)}...`);
        });
    }

    console.log('='.repeat(80) + '\n');
}

/**
 * Boucle principale
 */
async function runBot() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║      POLYMARKET BOT - SIMULATION AVEC CAPITAL              ║
║                                                            ║
║  Capital de départ: ${CONFIG.STARTING_CAPITAL} USDC                              ║
║  Mode: SIMULATION PURE                                     ║
╚════════════════════════════════════════════════════════════╝
`);

    // Charger l'état précédent si existe
    loadState();

    while (true) {
        try {
            console.log(`\n[${new Date().toLocaleString('fr-FR')}] 🔄 Cycle de trading...`);

            // 1. Récupérer les données PizzINT
            const pizzaData = await getPizzaData();
            if (pizzaData) {
                botState.lastPizzaData = pizzaData;
                console.log(`🍕 Pizza Index: ${pizzaData.index} | DEFCON: ${pizzaData.defcon}`);
            }

            // 2. Vérifier et fermer des trades
            await checkAndCloseTrades();

            // 3. Chercher de nouvelles opportunités
            if (pizzaData && botState.capital >= CONFIG.MIN_TRADE_SIZE) {
                const shouldTrade = pizzaData.defcon <= CONFIG.DEFCON_THRESHOLD || Math.random() < 0.3;

                if (shouldTrade && botState.activeTrades.length < 10) {
                    console.log('🔍 Recherche d\'opportunités...');

                    const markets = await getRelevantMarkets();
                    console.log(`📊 ${markets.length} marchés pertinents trouvés`);

                    if (markets.length > 0) {
                        // Choisir un marché aléatoire parmi les meilleurs
                        const market = markets[Math.floor(Math.random() * Math.min(5, markets.length))];

                        // Vérifier qu'on n'a pas déjà ce marché
                        const alreadyTraded = botState.activeTrades.some(t => t.marketId === market.id);
                        if (!alreadyTraded) {
                            simulateTrade(market, pizzaData);
                        }
                    }
                }
            } else if (botState.capital < CONFIG.MIN_TRADE_SIZE) {
                console.log('⚠️  CAPITAL ÉPUISÉ - Arrêt du trading');
            }

            // 4. Mettre à jour et afficher le statut
            botState.lastUpdate = new Date().toISOString();
            saveState();
            displayStatus();

            // 5. Attendre avant le prochain cycle
            console.log(`⏳ Prochain cycle dans ${CONFIG.POLL_INTERVAL_MINUTES} minutes...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MINUTES * 60 * 1000));

        } catch (error) {
            console.error('❌ Erreur dans la boucle:', error);
            await new Promise(resolve => setTimeout(resolve, 60000));
        }
    }
}

// Démarrer le bot
runBot().catch(console.error);
