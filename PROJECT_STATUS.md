# 🤖 AUTO_POLYMARKET - Project Context & Handoff

## 📅 Status au 9 Février 2026
- **Déploiement** : Railway (Stable).
- **Database** : Supabase (Connecté & Hébergé).
- **Frontend** : Dashboard HTML/JS unifié (`bot_dashboard.html`).
- **Dernier Commit** : `Fix: Restore missing Javascript for Marketplace navigation` (Marketplace Backend + Frontend OK).

## 🏗️ Architecture Actuelle
- **`server.js`** : Point d'entrée. Gère Express, WebSocket (Dashboard), et la boucle principale du bot (`engine.js`).
- **`src/logic/engine.js`** : Cerveau du trading. Gère les stratégies (Gamma, Alpha), l'exécution des ordres, et la gestion des positions.
- **`src/services/supabaseService.js`** : Service pour interagir avec Supabase (sauvegarde des trades, logs).
- **`bot_dashboard.html`** : Interface utilisateur unique. Contient toute la logique JS client (Charts, WebSocket, Appels API).
  - **Onglets** : Dashboard (Trading Live) et Marketplace (Deep Scan 1000+ marchés).

## 🔑 Variables d'Environnement (Railway)
- `SUPABASE_URL` : URL de l'instance Supabase.
- `SUPABASE_KEY` : Clé `service_role` ou `anon` (pour l'instant `anon` suffit pour le bot).
- `PRIVATE_KEY` : Clé privée du wallet (Polygon).
- `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_PASSPHRASE` : Clés API Polymarket (optionnelles pour lecture, requises pour trading réel).

## 🚀 Features Déployées
1.  **Automated Trading** : Le bot scanne et trade selon les stratégies définies.
2.  **Data Persistence** : Les nouveaux trades sont sauvegardés dans Supabase (`supabaseService.saveTrade`).
3.  **Deep Scan & Marketplace** :
    - `/api/markets` retourne les 1000+ marchés scannés (cached).
    - L'UI "Marketplace" permet de voir, filtrer et trier ces marchés.
4.  **Health Check** : `/api/health-db` vérifie la connexion Supabase.

## 🔮 Roadmap & Prochaines Étapes (Pour le prochain Agent)

### 1. Supabase Analytics (Priorité 1)
L'objectif est d'utiliser Supabase non plus comme un simple log, mais comme un cerveau.
- **Ingestion Historique** : Créer un script pour importer tout l'historique des paris de l'utilisateur (via Polymarket API) dans Supabase `trades`.
- **Analyse de Performance** : Créer des Vues SQL pour analyser PnL par catégorie (Sport, Crypto, Politics).

### 2. Spécialisation "Sport Expert"
- Modifier `engine.js` ou créer `src/logic/sportEngine.js` pour filtrer spécifiquement les marchés sportifs.
- Connecter une API de stats sportives (ex: API-Football ou scraper) pour donner un "edge" au bot (comparaison cotes Polymarket vs Stats réelles).

### 3. UX Improvements
- **Fix Empty State** : La Marketplace affiche un écran vide si le scan est en cours. Ajouter un message "Scan en cours...".
- **Mobile View** : Améliorer le CSS pour l'affichage mobile.

## 📝 Prompt de Démarrage pour le nouvel Agent
*"Tu reprends le projet Auto_Polymarket. Le bot tourne sur Railway avec Supabase connecté. 
Le code est propre, mais on veut passer au niveau supérieur : l'analyse de données.
1. Analyse le fichier `PROJECT_STATUS.md` pour comprendre l'architecture.
2. Ta première mission : Script d'importation de l'historique Polymarket dans Supabase pour entraîner l'IA."*
