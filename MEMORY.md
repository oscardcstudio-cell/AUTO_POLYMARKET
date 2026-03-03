# MEMORY.md — État du projet au 03/03/2026

## Capital & État
- **Capital simulé** : $7,000 (reset propre le 03/03/2026)
- **STARTING_CAPITAL** dans config.js : 7000
- **Note** : Railway utilise `/app/data/bot_data.json` (volume persistant) — le reset local peut ne pas s'appliquer en prod sans diagnostic Railway

## Stratégies actives
- standard, wizard, event_driven, copy_trade
- hype_fader, panic_buy, calendar_edge (v2)
- semantic_arb, quant_model (élections)
- sports (intelligence sportive)

## Stratégies désactivées (bot_data.json → strategyOverrides.disabledStrategies)
- whale (WR 41%, -$16)
- contrarian (WR 38%, -$9.73)
- smart_momentum (WR 14%, -$7.91)
- calendar (v1, WR 18% — remplacé par calendar_edge)
- cross_market (pas de données WR)

## Nouveaux fichiers créés
- `src/api/marketBehavior.js` — Hype Fader, Panic Buy, Calendar Edge v2
- `src/api/quantModel.js` — modèle quantitatif 4 couches (élections)
- `src/api/semanticArbitrage.js` — arbitrage cross-market logique

## Paramètres clés (config.js)
- BASE_MAX_TRADES: 50
- MAX_TRADE_SIZE_PERCENT: 0.20 (20%)
- MAX_POSITION_PCT: 0.20
- MAX_THEME_PCT: 0.20
- MIN_LIQUID_PCT: 0.30
- COPY_SIZE_PERCENT: 0.023
- KELLY_FRACTION: 0.2

## Protections Risk Management
1. **Liquidity Gate** : conviction min selon liquidité (60/50/35/32 pts)
2. **Volatility Sizing** : ×0.65/×0.85/×1.10 selon range intraday
3. **Monthly Drawdown** : DEFENSIVE(-12%), CONSERVATION(-20%), KILL(-25%)
4. **Strategy Auto-Disable** : WR<30% → off, WR≥55% → réactivation auto
5. Stop-loss 8-15%, Take-profit 15/20/30%, trailing stop +10%
6. Réserve liquide 30%, cap spéculatif 20%

## Signal Stacking (6 combos dans engine.js)
- Whale + Copy → +20 pts
- Wizard + Event → +18 pts
- Calendar + Panic → +18 pts
- Semantic Arb + Quant → +14 pts
- Wizard + News → +12 pts
- 3+ signaux → +15 pts

## Dashboard (bot_dashboard.html)
- Cartes ajoutées : Hype Fader/Panic Buy, Calendar Edge v2, Monthly Risk, Strategy Health Monitor
- Fixes : RAPPORTS & ÉVOLUTION (display:none retiré), LIVE SYSTEM LOGS (try-catch isolé)

## Tâches en attente (prochaine session)
1. **Bouton PAUSE temps réel** — stopper nouveaux trades sans redéployer
2. **Config live via dashboard** — modifier seuils sans code
3. **WebSocket** — à reconsidérer après 100+ trades (données insuffisantes)
4. **Sharpe ratio / Profit Factor** dans le dashboard (métriques avancées)
5. Vérifier que le reset $7k a bien pris sur Railway (diagnostiquer via `node scripts/diagnose_railway_state.js`)

## Questions ouvertes
- Le volume 1h n'est pas disponible via les APIs Polymarket (seulement volume24h)
- Semantic Arbitrage = directional risk (une seule jambe) pas vrai arbitrage
- Hype Fader ne distingue pas rumeur vs news structurelle (angle mort)

## Dernière session
- Engue a travaillé sur la session
- Branche : main
- Dernier commit : 3863422 (Add auto strategy performance monitoring)
