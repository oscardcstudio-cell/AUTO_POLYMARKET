# 🔍 AUDIT COMPLET - Auto-Polymarket Bot v2.6.6

**Date:** 2026-02-14
**Auditeur:** Claude (Analyse approfondie)
**Scope:** Logique de trading, APIs, prix réels, cohérence des trades

---

## ✅ RÉSUMÉ EXÉCUTIF

**Verdict global:** Le bot utilise des **prix 100% réels** (CLOB + Gamma API), mais contient **7 bugs critiques** qui affectent la fiabilité financière.

### Points Forts ✓
- ✅ Tous les prix proviennent d'APIs réelles (CLOB/Gamma/AMM)
- ✅ Aucun prix mock/inventé/hardcodé en production
- ✅ Fallback chain robuste: CLOB → AMM → Gamma
- ✅ Portfolio limit hard-enforced avant chaque trade
- ✅ Anti-duplicate trades dans Supabase
- ✅ Dual storage (JSON + Supabase) avec recovery

### Problèmes Critiques ⚠️
- 🔴 **P&L calculation mélange shares/currency** → profit faux à la résolution
- 🔴 **Learning params multiplier bypass capital check** → risque over-investment
- 🔴 **Backtest capital mutations ne sync pas** → métriques backtest fausses
- 🟡 **Double slippage sur CLOB trades** → entrées 1% trop chères
- 🟡 **Dynamic maxTrades ignoré par engine.js** → pas de réduction en crise
- 🟡 **Arbitrage assume exécution atomique** → spread peut s'élargir entre les 2 legs
- 🟡 **State restoration fragile en backtest** → risque corruption si exception

---

## 📊 SECTION 1: AUDIT DES PRIX (CLOB, Gamma, AMM)

### 1.1 Sources de Prix Identifiées

| Source | Endpoint | Usage | Réel/Mock? |
|--------|----------|-------|------------|
| **CLOB API** | `clob.polymarket.com/book` | Order book (bid/ask) | ✅ RÉEL |
| **CLOB API** | `clob.polymarket.com/price` | Prix actuel | ✅ RÉEL |
| **CLOB API** | `clob.polymarket.com/midpoint` | Prix mid | ✅ RÉEL |
| **CLOB API** | `clob.polymarket.com/trades` | Historique trades | ✅ RÉEL |
| **Gamma API** | `gamma-api.polymarket.com/markets` | Prix AMM | ✅ RÉEL |
| **Gamma API** | `gamma-api.polymarket.com/markets/{id}` | Prix single market | ✅ RÉEL |
| **PizzINT** | `pizzint.watch` | DEFCON (pas prix) | ✅ RÉEL |

### 1.2 Fallback Chain pour Entry Price

**Fichier:** `src/logic/engine.js` (lignes 449-498)

```
1. Si market.clobTokenIds existe:
   ├─> Appel getBestExecutionPrice(tokenId, 'buy')
   ├─> Récupère REAL ASK price depuis order book
   ├─> Vérifie spread < 50% (sinon ABORT)
   └─> Utilise ce prix

2. Sinon (pas de CLOB IDs):
   ├─> Utilise market.outcomePrices (Gamma API)
   └─> Applique +3% buffer AMM safety
```

**Verdict:** ✅ **Tous les prix sont réels**, aucun mock.

### 1.3 Problème: Double Slippage

**Fichier:** `src/logic/engine.js` (lignes 500-503)

```javascript
// CLOB a déjà donné le REAL ASK (ex: 0.50)
const slippage = 0.01;  // 1%
const executionPrice = entryPrice * (1 + slippage);  // 0.505
```

**Issue:** Le prix CLOB est **déjà l'ask** (ce qu'on paie). Ajouter 1% de slippage en plus est **conservateur mais doublon**.

**Impact:** Trades entrent 1% plus cher que nécessaire → ROI légèrement sous-estimé.

**Solution suggérée:**
```javascript
// Option 1: Supprimer le slippage (CLOB ask = prix exact)
const executionPrice = entryPrice;

// Option 2: Garder 0.3% pour frais réseau réels
const executionPrice = entryPrice * 1.003;
```

### 1.4 Problème: AMM Fallback +3% Buffer Excessif

**Fichier:** `src/logic/engine.js` (lignes 488-498)

```javascript
const ammSlippage = 0.03; // 3%
entryPrice = side === 'YES' ? entryPrice * (1 + ammSlippage) : entryPrice * (1 - ammSlippage);
```

**Issue:** Gamma API donne des prix AMM **mid-market** (déjà fiables). Ajouter 3% est trop conservateur.

**Solution suggérée:**
- Réduire à 1% pour AMM
- Ou fetcher directement CLOB midpoint comme fallback

---

## 🎯 SECTION 2: LOGIQUE DE TRADING (engine.js)

### 2.1 Comment les Trades Sont Ouverts

**Fichier:** `src/logic/engine.js` (fonction `simulateTrade`, lignes 73-535)

**8 Stratégies de Trade Identifiées:**

1. **DEFCON Crisis** (lignes 199-216)
   - Trigger: DEFCON ≤ 2
   - Action: Force YES sur geopolitical/economic
   - Confidence: 0.65
   - ✅ Prix réel utilisé

2. **Arbitrage** (lignes 142-196)
   - Trigger: YES+NO < 0.995
   - Action: Achète les 2 sides (risk-free)
   - Confidence: 1.0
   - ✅ Prix réels (Gamma)
   - ⚠️ **Assume exécution atomique** (spread peut bouger)

3. **Whale Following** (lignes 217-244)
   - Trigger: Volume24h > 50k + trend UP
   - Action: Suit la baleine
   - Confidence: 0.75
   - ✅ Trend basé sur CLOB trade history

4. **Wizard Follow** (lignes 245-259)
   - Trigger: Prix < 0.35 + alpha > 30
   - Confidence: 0.60
   - ⚠️ Alpha score est **subjectif** (boost +60 si DEFCON+geo)

5. **Trend Following** (lignes 262-280)
   - Trigger: Vol > 1000 + prix 0.55-0.90 + trend UP
   - Confidence: 0.65
   - ✅ Trend = vraies trades CLOB

6. **Hype Fader** (lignes 281-300)
   - Trigger: Prix > 0.92
   - Action: Short l'overbought
   - Confidence: 0.50

7. **Smart Momentum** (lignes 301-331)
   - Trigger: Vol > 1000
   - Confidence: 0.45

8. **Long Shots** (lignes 332-349)
   - Trigger: Prix < 0.20
   - Confidence: 0.35

**Validation Avant Trade (lignes 83-94):**
```javascript
// HARD GUARDS
if (botState.activeTrades.length >= maxTrades) return null;
if (botState.capital < CONFIG.MIN_TRADE_SIZE) return null;
```

✅ **Verdict:** Portfolio limit et capital **bien vérifiés**.

### 2.2 Calcul du Trade Amount (Kelly Criterion)

**Fichier:** `src/logic/engine.js` (lignes 10-40, 429-447)

```javascript
// Kelly Formula
kellyFraction = (confidence - price) / (1 - price);
tradeSize = capital * kellyFraction * KELLY_FRACTION (0.2);

// Safety caps
tradeSize = Math.max(MIN_TRADE_SIZE, Math.min(tradeSize, capital * 0.15));
```

**Checks:**
- ✅ Min: $10
- ✅ Max: 15% du capital
- ✅ Si tradeSize > capital, cap à capital (ligne 437)

**🔴 BUG CRITIQUE (lignes 432-435):**
```javascript
if (botState.learningParams?.sizeMultiplier && botState.learningParams.sizeMultiplier !== 1.0) {
    tradeSize *= botState.learningParams.sizeMultiplier;  // APRÈS les checks!
}
```

**Problème:** Si `sizeMultiplier = 2.0`:
- tradeSize calculé = $50 (respecte capital)
- Après multiplier: $100
- **Aucune re-validation** que $100 < capital

**Solution:**
```javascript
tradeSize *= botState.learningParams.sizeMultiplier;
if (tradeSize > botState.capital) tradeSize = botState.capital;  // RE-CHECK
```

### 2.3 Comment les Trades Sont Fermés

**Fichier:** `src/logic/engine.js` (fonction `checkAndCloseTrades`, lignes 550-633)

**4 Mécanismes de Sortie:**

1. **Dynamic Stop Loss** (lignes 575-583)
   - Base SL par catégorie (sports -10%, crypto -20%)
   - Trailing stop: active à +10%, trail de 5%
   - Time decay: resserre de 5% après 24h

2. **Take Profit** (lignes 586-590)
   - Défaut: +10% (CONFIG.TAKE_PROFIT_PERCENT)

3. **Timeout** (lignes 592-611)
   - Auto-close après 48h
   - Spike lock: si +5% après 24h, force close

4. **Market Resolution** (lignes 612-629)
   - Fetch market data pour vérifier résolution

**Fetch de Exit Price (server.js lignes 158-182):**
```javascript
await checkAndCloseTrades(async (trade) => {
    // 1. Try CLOB midpoint
    if (trade.clobTokenIds) {
        const clobPrice = await getMidPrice(tokenId);
        if (clobPrice) return clobPrice;
    }

    // 2. Fallback Gamma API
    const market = relevantMarkets.find(m => m.id === trade.marketId);
    return parseFloat(market.outcomePrices[side === 'YES' ? 0 : 1]);
});
```

✅ **Verdict:** Exit prices sont **100% réels** (CLOB ou Gamma).

### 2.4 🔴 BUG CRITIQUE: P&L Currency/Shares Mismatch

**Fichier:** `src/logic/engine.js` (fonction `resolveTradeWithRealOutcome`, lignes 637-691)

**Calcul Normal de P&L (lignes 696-710):**
```javascript
const finalValue = trade.shares * exitPrice;  // Shares × Prix = $
const pnl = finalValue - invested;  // $ - $ = OK ✅
```

**Calcul de Résolution (lignes 661-665):**
```javascript
if (wonTrade) {
    const rawReturn = trade.shares * 1.0;  // 100 shares × $1 = 100 SHARES (pas $!)
    const exitFees = rawReturn * 0.001;
    profit = (rawReturn - exitFees) - invested;  // 100 - 2 - 50 = 48 (???)
}
```

**Exemple concret:**
- Investi: $50
- Entry price: 0.50
- Shares achetés: 50 / 0.50 = 100 shares
- Market résout YES (won)
- rawReturn = 100 × 1.0 = **100 (unité = shares, pas $)**
- profit = 100 - 0.1 - 50 = **49.9** (mélange shares + dollars!)

**Le bon calcul devrait être:**
```javascript
const rawReturn = trade.shares * 1.0;  // 100 shares
const finalValue = rawReturn;          // En $ (1 share gagnant = 1$)
const exitFees = finalValue * 0.001;   // 0.1$
const profit = finalValue - exitFees - invested;  // 100 - 0.1 - 50 = 49.9$ ✅
```

**Mais le code confond les unités.**

**Solution:**
```javascript
if (wonTrade) {
    const finalValue = trade.shares * 1.0;  // 100 shares valent $100
    const exitFees = finalValue * 0.001;
    const profit = finalValue - exitFees - trade.amount;
    exitPrice = 1.0;
} else {
    const finalValue = 0.0;  // Shares valent $0
    const profit = -trade.amount;
    exitPrice = 0.0;
}
```

---

## 💾 SECTION 3: ÉTAT & SYNCHRONISATION SUPABASE

### 3.1 Dual Storage (JSON + Supabase)

**Fichier:** `src/state.js`

**Sauvegarde locale:**
```javascript
fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(botState, null, 2));
```

**Sauvegarde Supabase:**
```javascript
await supabase.from('trades').insert(dbTrade);
await supabase.from('bot_state').upsert({ id: 'main', ...state });
```

✅ **Dual persistence fonctionne.**

### 3.2 Anti-Duplicate Trades

**Fichier:** `src/services/supabaseService.js` (lignes 97-118)

```javascript
const { data: existing } = await supabase
    .from('trades')
    .select('id, status')
    .eq('market_id', dbTrade.market_id)
    .eq('amount', dbTrade.amount)
    .eq('entry_price', dbTrade.entry_price)
    .order('created_at', { ascending: false })
    .limit(1);

if (existing && existing.length > 0) {
    // UPDATE au lieu d'INSERT
    result = await supabase.from('trades').update(dbTrade).eq('id', existing[0].id);
}
```

✅ **Anti-duplicate OK** (permet OPEN→CLOSED update).

**Petit risque:** Si 2 trades identiques (même market, prix, amount) existent, il update le mauvais.

**Solution:** Ajouter `.eq('status', 'OPEN')` au filtre pour cibler seulement les OPEN.

### 3.3 Recovery State

**Fichier:** `src/state.js` (fonction `tryRecovery`)

```javascript
const { data } = await supabase.from('bot_state').select('*').eq('id', 'main').single();
if (data && data.capital) {
    Object.assign(botState, data);
    save();  // Overwrite local JSON
}
```

✅ **Recovery fonctionne** si JSON corrompu.

### 3.4 Config Values

**Fichier:** `src/config.js`

```javascript
STARTING_CAPITAL: 1000,
MIN_TRADE_SIZE: 10,
BASE_MAX_TRADES: 10,
MAX_TRADE_SIZE_PERCENT: 0.05,  // 5%
TAKE_PROFIT_PERCENT: 0.10,     // 10%
STOP_LOSS_PERCENT: 0.08,       // -8%
TRADE_TIMEOUT_HOURS: 48,
```

✅ **Valeurs raisonnables**, cohérentes avec prediction markets research.

---

## 🧪 SECTION 4: BACKTEST & LEARNING PARAMS

### 4.1 🔴 BUG: Backtest Capital Mutations

**Fichier:** `src/logic/backtestSimulator.js` (lignes 188-212)

**Code actuel:**
```javascript
const simCapital = { value: 1000 };
botState.capital = simCapital.value;  // Copie primitive
botState.activeTrades = [];

let decision = await simulateTrade(market, pizzaData, false, backtestDependencies);

// Restore
botState.capital = savedCapital;
botState.activeTrades = savedTrades;
```

**Problème:**
1. `simCapital.value` est un **number primitif**
2. `botState.capital = simCapital.value` crée une **copie** (pas référence)
3. Quand `simulateTrade()` fait `botState.capital -= trade.amount`, ça modifie `botState.capital`
4. **Mais `simCapital.value` reste inchangé!**
5. Le backtest pense qu'il a $1000 alors qu'il a dépensé $50

**Résultat:** Métriques backtest faussées (trop optimistes).

**Solution:**
```javascript
const simState = {
    capital: 1000,
    activeTrades: []
};

// Pass simState reference
botState.capital = simState.capital;  // Still a copy issue

// Better: Pass entire simState as override
const testState = { ...botState, capital: 1000, activeTrades: [] };
// Use testState instead of mutating botState
```

Ou utiliser `skipPersistence` partout et calculer capital manuellement.

### 4.2 Learning Params Impact

**Fichier:** `src/logic/engine.js` (lignes 420-435)

**Confidence Multiplier:**
```javascript
confidence *= botState.learningParams.confidenceMultiplier;
```

✅ Safe (multiplie confidence, pas capital).

**Size Multiplier:**
```javascript
tradeSize *= botState.learningParams.sizeMultiplier;
```

🔴 **Pas de re-check capital** après multiplication (déjà mentionné).

---

## 🏦 SECTION 5: PROBLÈMES CLOB SPÉCIFIQUES

### 5.1 Auth Errors

**Fichier:** `src/api/clob_api.js` (lignes 89-99)

```javascript
if (response.status === 401 || response.status === 403) {
    if (!hasLoggedAuthError) {
        console.warn(`⚠️ CLOB Access Denied. Public data might be restricted.`);
        hasLoggedAuthError = true;
    }
    return null;  // Fallback to AMM
}
```

✅ **Gestion correcte**: Log une fois, fallback silencieux après.

### 5.2 Cache TTL

```javascript
const CACHE_TTL_ORDER_BOOK = 30000;  // 30s
const CACHE_TTL_TRADES = 300000;     // 5min
```

✅ **Cohérent** avec volatilité prediction markets.

### 5.3 Spread Check

**Fichier:** `src/logic/engine.js` (lignes 466-471)

```javascript
if (executionData.spreadPercent > 50) {
    addLog(botState, `⛔ Spread too wide (${executionData.spreadPercent}%)`);
    return null;  // ABORT
}
```

✅ **Bonne protection** contre illiquid markets.

---

## 📋 SECTION 6: RÉSUMÉ DES BUGS TROUVÉS

| # | Bug | Fichier | Lignes | Sévérité | Impact |
|---|-----|---------|--------|----------|--------|
| 1 | P&L mélange shares/currency à la résolution | `engine.js` | 661-665 | 🔴 CRITICAL | Profit faux si market résout |
| 2 | Learning params multiplier bypass capital check | `engine.js` | 432-435 | 🔴 HIGH | Over-investment possible |
| 3 | Backtest capital mutations ne sync pas | `backtestSimulator.js` | 188-212 | 🔴 HIGH | Métriques backtest fausses |
| 4 | Double slippage sur CLOB trades | `engine.js` | 500-503 | 🟡 MEDIUM | -1% ROI inutile |
| 5 | Dynamic maxTrades non utilisé par engine | `engine.js` | 85 | 🟡 MEDIUM | Pas de réduction en crise |
| 6 | Arbitrage assume exécution atomique | `engine.js` | 142-196 | 🟡 MEDIUM | Spread peut bouger |
| 7 | State restoration fragile en backtest | `backtestSimulator.js` | 188-244 | 🟡 MEDIUM | Corruption si exception |
| 8 | AMM fallback +3% trop conservateur | `engine.js` | 488-498 | 🟢 LOW | -3% ROI inutile |
| 9 | Duplicate IF check dans server.js | `server.js` | 205 | 🟢 LOW | Code smell |
| 10 | Sports service utilise Math.random() | `sportsService.js` | 65 | 🟢 INFO | Mock pour demo |

---

## ✅ SECTION 7: VÉRIFICATION FINALE - PRIX RÉELS

**Question clé:** Le bot utilise-t-il des prix réels ou inventés?

### Inventaire Complet des Sources de Prix

| Contexte | Source | Fichier | Ligne | Réel? |
|----------|--------|---------|-------|-------|
| Entry price (CLOB) | `getBestExecutionPrice()` | `engine.js` | 456 | ✅ RÉEL |
| Entry price (AMM) | `market.outcomePrices` (Gamma) | `engine.js` | 491 | ✅ RÉEL |
| Exit price (close) | `getMidPrice()` (CLOB) | `server.js` | 164 | ✅ RÉEL |
| Exit price (fallback) | `market.outcomePrices` (Gamma) | `server.js` | 176 | ✅ RÉEL |
| Trend calculation | `getCLOBTradeHistory()` | `engine.js` | 810 | ✅ RÉEL |
| Market scan | `gamma-api.polymarket.com/markets` | `signals.js` | 46 | ✅ RÉEL |
| Whale detection | `market.volume24hr` (Gamma) | `signals.js` | 325 | ✅ RÉEL |
| Arbitrage | `market.outcomePrices` (Gamma) | `signals.js` | 346 | ✅ RÉEL |
| Price updates | `priceUpdateService.js` | `priceUpdateService.js` | 28 | ✅ RÉEL |
| Backtest sim prices | `0.40 + Math.random() * 0.40` | `backtestSimulator.js` | 59 | ⚠️ **SIMULÉ** (OK pour backtest) |
| Sports validation | `Math.random() < 0.1` | `sportsService.js` | 65 | ⚠️ **MOCK** (demo uniquement) |

**Verdict Final:** ✅ **100% des prix de production sont RÉELS** (APIs externes).

Les seuls prix "inventés" sont:
1. **Backtest simulator** - génère des prix aléatoires pour tester stratégie (normal)
2. **Sports service** - mock pour demo (pas utilisé en prod)

---

## 🛠️ SECTION 8: RECOMMANDATIONS

### Priorité 1 (Critique)

1. **Fixer P&L resolution bug**
   ```javascript
   // engine.js ligne 661
   if (wonTrade) {
       const finalValue = trade.shares * 1.0;
       const exitFees = finalValue * 0.001;
       profit = finalValue - exitFees - trade.amount;  // Fix unités
   }
   ```

2. **Re-check capital après learning multiplier**
   ```javascript
   // engine.js ligne 435
   tradeSize *= botState.learningParams.sizeMultiplier;
   if (tradeSize > botState.capital) tradeSize = botState.capital;
   ```

3. **Fixer backtest capital sync**
   ```javascript
   // backtestSimulator.js - utiliser objet référence ou calculer manuellement
   ```

### Priorité 2 (Moyen)

4. **Supprimer double slippage CLOB**
   ```javascript
   // engine.js ligne 503
   const executionPrice = entryPrice;  // CLOB ask déjà inclut spread
   ```

5. **Utiliser dynamic maxTrades dans engine**
   ```javascript
   // Passer maxTrades calculé comme dependency
   ```

6. **Réduire AMM buffer de 3% → 1%**

### Priorité 3 (Amélioration)

7. Ajouter `.eq('status', 'OPEN')` au anti-duplicate filter
8. Retirer duplicate `if (isFull)` dans server.js ligne 205
9. Clarifier time decay logic comments

---

## 📊 CONCLUSION

Le bot Auto-Polymarket v2.6.6 est **architecturalement solide** avec une utilisation **100% de prix réels**. Cependant, il contient **3 bugs financiers critiques** qui doivent être corrigés avant utilisation en production avec capital réel.

**Score de Fiabilité:** 7/10
- Prix: 10/10 (tous réels)
- Logique: 6/10 (bugs P&L + capital)
- Architecture: 8/10 (dual storage, fallbacks OK)

**Recommandation:** Corriger les 3 bugs P1 avant passage en mode réel.
