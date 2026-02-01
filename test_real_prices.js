// Test de l'API Polymarket pour récupérer les vrais prix
import fetch from 'node-fetch';

async function testPriceAPI() {
    // Exemple de market ID (Trevor Lawrence)
    const marketId = '541519';

    console.log('🔍 Test 1: API Gamma pour récupérer les données du marché...');
    try {
        const response = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`);
        const data = await response.json();

        console.log('✅ Réponse reçue:');
        console.log('- Question:', data.question);
        console.log('- Last Trade Price:', data.lastTradePrice);
        console.log('- Outcome Prices:', data.outcomePrices);
        console.log('- CLOB Token IDs:', data.clobTokenIds);

        if (data.clobTokenIds && data.clobTokenIds.length > 0) {
            console.log('\n📊 Tokens CLOB:');
            data.clobTokenIds.forEach((token, i) => {
                console.log(`  Token ${i}:`, {
                    outcome: token.outcome,
                    price: token.price,
                    token_id: token.token_id
                });
            });
        }
    } catch (e) {
        console.error('❌ Erreur:', e.message);
    }

    console.log('\n🔍 Test 2: API CLOB pour récupérer le prix en temps réel...');
    try {
        // Essayer avec l'endpoint CLOB
        const response = await fetch('https://clob.polymarket.com/markets');
        const data = await response.json();
        console.log('✅ Nombre de marchés:', data.length);

        // Chercher notre marché
        const market = data.find(m => m.condition_id === marketId);
        if (market) {
            console.log('- Marché trouvé:', market.question);
            console.log('- Tokens:', market.tokens);
        }
    } catch (e) {
        console.error('❌ Erreur:', e.message);
    }
}

testPriceAPI();
