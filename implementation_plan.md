# Plan d'Implémentation : Auto Polymarket Trader (Pizzint Edition)

Ce document décrit la feuille de route pour construire une application de trading automatisé sur Polymarket basée sur les signaux de `https://www.pizzint.watch/`.

**Objectif** : Un script stable qui trade automatiquement, suivi d'une interface simple pilotable par l'utilisateur.

## Phase 1 : Acquisition de Données (Le "Watcher")
L'objectif est de récupérer les données en temps réel (ou quasi réel) de `pizzint.watch`.
- [ ] **Analyse du site** : Vérifier si une API cachée existe (via Network Tab) ou si le scraping HTML est nécessaire.
- [ ] **Implémentation** :
    - Utiliser `puppeteer` ou `cheerio`/`axios` pour lire les données.
    - Extraire les indicateurs clés (ex: "Doughcon Level" ou autre métrique spécifique).
    - Extraire les indicateurs clés (ex: "Doughcon Level" ou autre métrique spécifique).
    - [x] Mettre en place un système de polling (vérification toutes les X secondes).

## Phase 2 : Connexion Polymarket (Le "Trader")
L'objectif est de pouvoir exécuter des ordres sur Polymarket via code.
- [ ] **Setup API / Wallet** :
    - Créer/Connecter un wallet (ex: MetaMask/PrivateKey) dédié au bot (Polygon Network).
    - Obtenir les clés API Polymarket (si nécessaire) ou utiliser le SDK (ex: `@polymarket/clob-client`).
- [ ] **Fonctions de Base** :
    - `getBalance()` : Vérifier les fonds (USDC.e).
    - `getMarket(conditionId)` : Récupérer les infos d'un marché spécifique.
    - `placeOrder(side, size, price)` : Acheter (Yes/No).

## Phase 3 : Moteur de Stratégie (Le "Cerveau")
Lier les données au trading.
- [ ] **Logique de Décision** :
    - *Exemple* : SI `Pizzint Score` > 80 ALORS `Acheter YES` sur le marché correspondant.
- [ ] **Gestion des Risques** :
    - Limites de mise (ex: max 10$ par trade).
    - Stop-loss basique.

## Phase 4 : Interface Utilisateur (Le "Dashboard")
Une interface web simple pour contrôler le bot.
- [ ] **Tech Stack** : Serveur Node.js (Express) + Frontend simple (HTML/JS standard ou React lite).
- [ ] **Fonctionnalités** :
    - Bouton Start/Stop.
    - Logs des activités ("Signal détecté", "Ordre placé").
    - Bouton Start/Stop.
    - Logs des activités ("Signal détecté", "Ordre placé").
    - Affichage du solde et des positions en cours.
    - [x] Status Badges (Alpha, Gamma, Price)
    - [x] Status Badges (Alpha, Gamma, Price)
    - [x] Backtest Monitor
    - [x] Debug Screenshots
    - [x] Disable Auto-Git Sync (Stability)

## Architecture Technique (Actuelle)
- **Langage** : Node.js (JavaScript/ES Modules)
- **Dépendances probables** : `dotenv` (sécurité), `axios/puppeteer` (data), `ethers` (web3), `@polymarket/clob-client` (trading).

---
*Note pour la prochaine session : Commencer par l'analyse de pizzint.watch pour déterminer la méthode de récupération des données.*
