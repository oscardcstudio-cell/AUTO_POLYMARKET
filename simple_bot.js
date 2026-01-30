/**
 * POLYMARKET SIMULATION BOT
 * Mode entraînement - Pas de vrais trades, juste du tracking
 */

// Configuration simple
const CONFIG = {
    POLL_INTERVAL_MINUTES: 5,
    DEFCON_THRESHOLD: 3,
    MAX_TRADE_SIZE: 10, // Simulation en USDC
    KEYWORDS: ['Pentagon', 'Israel', 'Iran', 'Hezbollah', 'War', 'Strike', 'Attack', 'Military', 'Trump', 'Conflict']
};

// État du bot
let botState = {
    startTime: new Date(),
    totalTrades: 0,
    simulatedProfit: 0,
    activeTrades: [],
    closedTrades: [],
    lastPizzaData: null
};

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

        // Filtre les marchés géopolitiques
        return markets.filter(m => {
            const text = (m.question + ' ' + (m.description || '')).toLowerCase();
            return CONFIG.KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
        }).slice(0, 10); // Top 10

    } catch (error) {
        console.error('❌ Erreur Polymarket:', error.message);
        return [];
    }
}

/**
 * Simule un trade
 */
function simulateTrade(market, pizzaData) {
    const prices = JSON.parse(market.outcomePrices);
    const yesPrice = parseFloat(prices[0]);
    const noPrice = parseFloat(prices[1]);

    // Logique simple : Si DEFCON élevé, on parie sur YES (tension)
    const side = pizzaData.defcon <= CONFIG.DEFCON_THRESHOLD ? 'YES' : 'NO';
    const entryPrice = side === 'YES' ? yesPrice : noPrice;

    const trade = {
        id: `TRADE_${Date.now()}`,
        marketId: market.id,
        question: market.question,
        side: side,
        entryPrice: entryPrice,
        size: CONFIG.MAX_TRADE_SIZE,
        timestamp: new Date().toISOString(),
        endDate: market.endDateIso,
        pizzaIndex: pizzaData.index,
        defcon: pizzaData.defcon,
        status: 'OPEN'
    };

    botState.activeTrades.push(trade);
    botState.totalTrades++;

    console.log(`\n💰 TRADE SIMULÉ #${botState.totalTrades}`);
    console.log(`   Question: ${market.question}`);
    console.log(`   Side: ${side} @ ${entryPrice}`);
    console.log(`   Taille: ${CONFIG.MAX_TRADE_SIZE} USDC`);
    console.log(`   Fin du marché: ${market.endDateIso}`);
    console.log(`   Pizza Index: ${pizzaData.index} | DEFCON: ${pizzaData.defcon}`);
}

/**
 * Vérifie et clôture les trades terminés
 */
async function checkClosedMarkets() {
    for (let i = botState.activeTrades.length - 1; i >= 0; i--) {
        const trade = botState.activeTrades[i];

        try {
            const response = await fetch(`https://gamma-api.polymarket.com/markets/${trade.marketId}`);
            const market = await response.json();

            if (market.closed) {
                // Marché fermé, calculer le profit/perte
                const prices = JSON.parse(market.outcomePrices);
                const finalPrice = trade.side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
                const profit = (finalPrice - trade.entryPrice) * trade.size;

                trade.status = 'CLOSED';
                trade.exitPrice = finalPrice;
                trade.profit = profit;
                trade.closedAt = new Date().toISOString();

                botState.simulatedProfit += profit;
                botState.closedTrades.push(trade);
                botState.activeTrades.splice(i, 1);

                console.log(`\n✅ TRADE FERMÉ: ${trade.question}`);
                console.log(`   Profit: ${profit > 0 ? '+' : ''}${profit.toFixed(2)} USDC`);
            }
        } catch (error) {
            // Ignore les erreurs de vérification
        }
    }
}

/**
 * Affiche le statut du bot
 */
function displayStatus() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 STATUT DU BOT - Mode Simulation');
    console.log('='.repeat(80));
    console.log(`⏰ Démarré: ${botState.startTime.toLocaleString('fr-FR')}`);
    console.log(`📈 Trades totaux: ${botState.totalTrades}`);
    console.log(`💵 Profit simulé: ${botState.simulatedProfit > 0 ? '+' : ''}${botState.simulatedProfit.toFixed(2)} USDC`);
    console.log(`🔄 Trades actifs: ${botState.activeTrades.length}`);
    console.log(`✅ Trades fermés: ${botState.closedTrades.length}`);

    if (botState.lastPizzaData) {
        console.log(`\n🍕 Dernières données PizzINT:`);
        console.log(`   Index: ${botState.lastPizzaData.index}`);
        console.log(`   DEFCON: ${botState.lastPizzaData.defcon}`);
    }

    if (botState.activeTrades.length > 0) {
        console.log(`\n📋 Trades actifs:`);
        botState.activeTrades.forEach((t, i) => {
            console.log(`   ${i + 1}. ${t.question.substring(0, 60)}...`);
            console.log(`      ${t.side} @ ${t.entryPrice} | Fin: ${new Date(t.endDate).toLocaleDateString('fr-FR')}`);
        });
    }

    console.log('='.repeat(80) + '\n');
}

/**
 * Boucle principale
 */
async function runBot() {
    console.log('🚀 Démarrage du bot en mode simulation...\n');

    while (true) {
        try {
            console.log(`\n[${new Date().toLocaleString('fr-FR')}] 🔄 Cycle de vérification...`);

            // 1. Récupérer les données PizzINT
            const pizzaData = await getPizzaData();
            if (pizzaData) {
                botState.lastPizzaData = pizzaData;
                console.log(`🍕 Pizza Index: ${pizzaData.index} | DEFCON: ${pizzaData.defcon}`);
            }

            // 2. Vérifier les marchés fermés
            await checkClosedMarkets();

            // 3. Chercher de nouvelles opportunités
            if (pizzaData && pizzaData.defcon <= CONFIG.DEFCON_THRESHOLD) {
                console.log('🔥 ALERTE: Niveau DEFCON élevé! Recherche d\'opportunités...');

                const markets = await getRelevantMarkets();
                console.log(`📊 ${markets.length} marchés pertinents trouvés`);

                // Limiter à 1 nouveau trade par cycle pour ne pas surcharger
                if (markets.length > 0 && botState.activeTrades.length < 5) {
                    const market = markets[0];

                    // Vérifier qu'on n'a pas déjà ce marché
                    const alreadyTraded = botState.activeTrades.some(t => t.marketId === market.id);
                    if (!alreadyTraded) {
                        simulateTrade(market, pizzaData);
                    }
                }
            } else {
                console.log('✅ Situation normale, pas de nouveaux trades');
            }

            // 4. Afficher le statut
            displayStatus();

            // 5. Attendre avant le prochain cycle
            console.log(`⏳ Prochain cycle dans ${CONFIG.POLL_INTERVAL_MINUTES} minutes...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MINUTES * 60 * 1000));

        } catch (error) {
            console.error('❌ Erreur dans la boucle:', error);
            await new Promise(resolve => setTimeout(resolve, 60000)); // Attendre 1 min en cas d'erreur
        }
    }
}

// Démarrer le bot
console.log(`
╔════════════════════════════════════════════════════════════╗
║         POLYMARKET BOT - MODE SIMULATION                   ║
║                                                            ║
║  Ce bot simule des trades basés sur PizzINT               ║
║  Aucun argent réel n'est utilisé                          ║
║  Vous pourrez faire les trades manuellement plus tard     ║
╚════════════════════════════════════════════════════════════╝
`);

runBot().catch(console.error);
