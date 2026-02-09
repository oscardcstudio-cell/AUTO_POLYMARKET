# 🏗️ Architecture du Projet Polymarket Trading Bot

## 📍 Environnement de Production

**⚠️ IMPORTANT :** Ce bot tourne sur **Railway** (pas en local). Les données locales ne reflètent PAS l'état de production.

### Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│  UTILISATEUR (Local)                                    │
│  - Fichiers de code source                              │
│  - bot_data.json local (IGNORÉ, obsolète)              │
│  - Pousse vers GitHub                                   │
└────────────────┬────────────────────────────────────────┘
                 │ git push
                 ↓
┌─────────────────────────────────────────────────────────┐
│  GITHUB                                                  │
│  - Source code repository                               │
│  - Auto-déploiement vers Railway                        │
└────────────────┬────────────────────────────────────────┘
                 │ auto-deploy
                 ↓
┌─────────────────────────────────────────────────────────┐
│  RAILWAY (Production Server)                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Bot Process (Node.js)                          │   │
│  │  - Scan markets                                 │   │
│  │  - Execute trades                               │   │
│  │  - Update bot_data.json (volume)                │   │
│  └──────────────┬──────────────────────────────────┘   │
│                 │                                        │
│  ┌─────────────▼──────────────────────────────────┐   │
│  │  Railway Volume (/app/data)                     │   │
│  │  - bot_data.json (PRODUCTION)                   │   │
│  │  - Persiste entre redémarrages                  │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────┬────────────────────────────────────────┘
                 │ backup chaque trade
                 ↓
┌─────────────────────────────────────────────────────────┐
│  SUPABASE (PostgreSQL Cloud)                            │
│  - Table: trades                                        │
│  - Historique permanent de tous les trades             │
│  - URL: https://locsskuiwhixwwqmsjtm.supabase.co       │
│  - Accessible depuis partout                            │
└─────────────────────────────────────────────────────────┘
```

## 🔑 Variables d'Environnement

### Local (.env)
```bash
SUPABASE_URL=https://locsskuiwhixwwqmsjtm.supabase.co
SUPABASE_KEY=sb_publishable_eUdyffzMtRSyWm4nZhZYew_AH_7elvg
```

### Railway
Les mêmes variables doivent être configurées dans Railway → Variables

## 📊 Sources de Données

### 1. bot_data.json (Railway Volume)
- **Emplacement** : `/app/data/bot_data.json` sur Railway
- **Contenu** : État actuel du bot
  - capital (cash disponible)
  - activeTrades (positions ouvertes)
  - closedTrades (historique récent, limité à 50)
  - capitalHistory, logs, etc.
- **Accessible via** : API endpoint `/api/bot-data`
- **Mise à jour** : À chaque trade et à chaque cycle du bot

### 2. Supabase Database
- **Table** : `trades`
- **Schema** :
  ```sql
  - id (uuid, PK)
  - created_at (timestamp)
  - market_id (text)
  - question (text)
  - side (YES/NO)
  - amount (numeric)
  - entry_price (numeric)
  - exit_price (numeric, nullable)
  - pnl (numeric)
  - status (OPEN/CLOSED)
  - confidence (numeric)
  - strategy (text)
  - metadata (jsonb)
  ```
- **Accessible via** : 
  - API endpoint `/api/trade-history`
  - Direct Supabase client (voir `fetch_railway_data.js`)
- **Mise à jour** : Sauvegarde automatique via `supabaseService.saveTrade()`

## 🔧 Comment Accéder aux Données de Production

### Option 1 : Via le Dashboard Web
```
https://[votre-app-railway].railway.app
```
Le dashboard affiche les données en direct depuis Railway

### Option 2 : Via Script Node.js
```bash
node fetch_railway_data.js
```
Récupère les données directement depuis Supabase

### Option 3 : Via Supabase Dashboard
1. Aller sur https://supabase.com
2. Se connecter
3. Projet : `locsskuiwhixwwqmsjtm`
4. Table Editor → `trades`

## 🐛 Debugging

### Le bot_data.json local ne correspond pas à la prod
**Normal !** Le fichier local est obsolète. Utilisez les scripts pour récupérer les vraies données depuis Supabase.

### Le dashboard montre des données différentes de mon local
**Normal !** Le dashboard affiche les données Railway. Pour voir les mêmes données localement :
```bash
node fetch_railway_data.js
```

### Je veux tester en local
1. Copiez les données de prod : `node fetch_railway_data.js`
2. Remplacez votre `bot_data.json` local par `railway_data_snapshot.json`
3. Lancez le bot localement avec `node server.js`

## 📝 Workflow de Développement

1. **Modifier le code localement**
2. **Tester localement** (optionnel)
3. **Commit & Push vers GitHub**
4. **Railway auto-déploie** (~2 minutes)
5. **Vérifier le dashboard** pour confirmer

## ⚠️ Points d'Attention

- **NE JAMAIS** se fier au `bot_data.json` local pour le debugging
- **TOUJOURS** vérifier Supabase ou Railway pour les vraies données
- Les modifications de code ne prennent effet qu'après déploiement sur Railway
- Le bot sur Railway redémarre automatiquement après chaque déploiement

## 🛠️ Scripts Utiles

| Script | Description |
|--------|-------------|
| `fetch_railway_data.js` | Récupère les données de prod depuis Supabase |
| `cleanup_supabase_duplicates.js` | Nettoie les trades dupliqués |
| `start_dashboard.js` | Lance le dashboard localement |

## 📞 Endpoints API

| Endpoint | Description |
|----------|-------------|
| `/api/bot-data` | État complet du bot (bot_data.json) |
| `/api/trade-history` | Historique des trades (depuis Supabase) |
| `/api/health` | Health check du bot |
| `/api/health-db` | Health check Supabase |
| `/api/backlog` | Backlog de bugs/features |
