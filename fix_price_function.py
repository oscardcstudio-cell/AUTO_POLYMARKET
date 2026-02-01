import re

# Lire le fichier
with open('unified_bot.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Nouvelle fonction corrigée
new_function = '''async function getRealMarketPrice(marketId) {
    const cacheKey = `price_${marketId}`;
    const cached = priceCache.get(cacheKey);
    
    // Utiliser le cache si disponible et récent
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
        return cached.price;
    }
    
    try {
        // Utiliser l'API Gamma qui retourne les VRAIS prix de Polymarket
        const response = await fetchWithRetry(`https://gamma-api.polymarket.com/markets/${marketId}`);
        
        if (response.ok) {
            const market = await response.json();
            let price = 0;
            
            // 1. Priorité au dernier prix de trade (le plus récent et réel)
            if (market.lastTradePrice) {
                price = parseFloat(market.lastTradePrice);
            }
            // 2. Sinon utiliser les prix des outcomes (YES price)
            else if (market.outcomePrices && market.outcomePrices.length > 0) {
                price = parseFloat(market.outcomePrices[0]);
            }
            
            if (price > 0 && price < 1) {
                priceCache.set(cacheKey, { price, timestamp: Date.now() });
                return price;
            }
        }
    } catch (e) {
        console.error(`❌ Erreur fetch prix pour market ${marketId}:`, e.message);
    }
    
    return null; // Retourne null si échec
}'''

# Trouver et remplacer la fonction
pattern = r'async function getRealMarketPrice\([^)]+\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}'
content = re.sub(pattern, new_function, content, count=1)

# Sauvegarder
with open('unified_bot.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Fonction getRealMarketPrice corrigée !")
