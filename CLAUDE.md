# CLAUDE.md - Auto-Polymarket Trading Bot

## Qui est l'utilisateur
Oscar ne code pas. Il comprend l'AI et la logique du projet mais pas la syntaxe.
- Toujours expliquer les changements en langage simple AVANT de coder
- Ne jamais demander "tu veux que je fasse X ou Y ?" avec des choix techniques incompréhensibles
- Proposer des solutions, pas des options techniques
- En cas de doute, faire le choix le plus sûr (pas de breaking changes)

## Le projet en bref
Bot de trading automatisé pour Polymarket (marchés prédictifs).
- **Mode simulation** par défaut (SIMULATION_MODE: true) - NE JAMAIS passer en mode réel sans confirmation explicite
- Déployé sur **Railway** (auto-deploy au push GitHub)
- Base de données **Supabase** (PostgreSQL cloud)
- Dashboard HTML servi par Express sur le port 3000

## Architecture clé

### Fichiers critiques (ne pas casser)
- `server.js` - Boucle principale du bot et serveur Express
- `src/logic/engine.js` - Moteur de trading (logique d'achat/vente, sizing, stop-loss, take-profit)
- `src/logic/advancedStrategies.js` - 10 stratégies avancées (conviction, anti-fragility, calendar, DCA...)
- `src/logic/signals.js` - Scan marchés, détection signaux (wizards, whales, fresh markets)
- `src/logic/backtestSimulator.js` - Walk-forward backtesting avec train/test split
- `src/api/market_discovery.js` - Pagination Gamma API, deep scan
- `src/state.js` - Gestion d'état (JSON local + Supabase)
- `src/config.js` - Configuration centralisée (sizing, TP, SL, limites)
- `src/services/supabaseService.js` - Persistence cloud
- `src/cron/scheduler.js` - AI self-training toutes les 6h

### APIs externes
- **Gamma API** (`gamma-api.polymarket.com`) - Données de marché
- **CLOB API** (`clob.polymarket.com`) - Carnets d'ordres / prix réels
- **PizzINT** (`pizzint.watch`) - Intelligence géopolitique (DEFCON)

### Flux principal (boucle toutes les ~1 min)
1. Vérifier connectivité APIs
2. Récupérer données PizzINT (DEFCON, tendances)
3. Scanner les marchés (deep scan toutes les 30 min)
4. Fermer les trades existants (stop-loss / take-profit)
5. Détecter signaux (whales, tendances, arbitrage)
6. Exécuter nouveaux trades si portfolio pas plein
7. Sauvegarder état (local + Supabase)

## Commandes utiles

### Tester localement
```bash
node server.js
```

### Diagnostiquer le bot Railway
```bash
node scripts/diagnose_railway_state.js
```

### Auditer le système
```bash
node scripts/audit_system.js
```

### Reset complet (wallet + trades)
```bash
node scripts/reset_bot.js
```

### Nettoyer les trades orphelins en Supabase
```bash
node scripts/cleanup_orphan_trades.js
```

### Voir le dashboard
- Local : http://localhost:3000 après `node server.js`
- Production : https://autopolymarket-production.up.railway.app/

## Conventions de code
- Node.js avec ES modules (`import`/`export`)
- Async/await partout (pas de callbacks)
- Logging avec emojis dans la console (ex: `logBot("message")`)
- Gestion d'erreurs : try/catch avec fallback gracieux, jamais de crash silencieux
- Caching multi-niveaux : CLOB 30s, trades 5min, marchés 1min
- Retry avec backoff exponentiel sur tous les appels API

## Patterns importants
- **Dual storage** : toujours sauvegarder en local ET Supabase
- **Fallback chains** : CLOB -> AMM -> Gamma pour les prix
- **Anti-duplicate** : vérifier avant d'insérer un trade dans Supabase
- **State recovery** : si JSON local corrompu, restaurer depuis Supabase
- **skipPersistence** : le backtester passe `skipPersistence: true` — ne JAMAIS modifier `botState` (capital, activeTrades) dans ce mode

## Gotchas (pièges connus)
- `outcomePrices` de Gamma API est souvent un **JSON string**, pas un array — toujours `JSON.parse()` d'abord
- `clobTokenIds` pareil — JSON string à parser
- Supabase `trades` table n'a PAS de colonne `updated_at`
- Le drawdown doit se calculer sur **capital total** (cash + positions ouvertes), pas cash seul — sinon Anti-Fragility bloque tout dès qu'on ouvre des trades
- Le backtest modifie temporairement `botState` — utiliser `try/finally` pour garantir la restauration
- Sur Railway, chaque deploy perd l'état local → le bot tente la récupération Supabase

## Money Management (paramètres actuels)
- **Sizing spéculatif** : max $15 absolu si prix < 0.35, position divisée par 2
- **Stop-Loss** : 8% base, -15% override si prix < 0.35, trailing à +10% profit
- **Take-Profit** : 15% (low vol) / 20% (medium) / 30% (high vol), partial exit 50%
- **Exposition spéculative** : max 20% du capital sur marchés < 0.35
- **Re-entry** : max 2 entrées par marché
- **Gap protection** : si prix bouge >30%, attendre 1 cycle
- **Max loss cap** : -25% max par trade même sur gap

## Sécurité & garde-fous
- JAMAIS désactiver SIMULATION_MODE sans confirmation d'Oscar
- JAMAIS push --force sur main
- JAMAIS supprimer bot_data.json sans backup
- JAMAIS modifier les clés API dans le code (utiliser .env)
- Toujours tester localement avant de proposer un push

## Workflow de déploiement
1. Modifier le code
2. Tester localement (`node server.js`)
3. Commit avec message clair en anglais
4. Push sur GitHub -> Railway auto-deploy (~2 min)
5. Vérifier via `node scripts/diagnose_railway_state.js`

## Référence
- Protocole de debug : `docs/DEBUG_PROTOCOL.md`
