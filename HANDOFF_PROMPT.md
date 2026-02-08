# Prompt de Démarrage - Agent Suivant

Copie-colle ce prompt pour démarrer une nouvelle conversation avec le prochain Agent. Il contient tout le contexte nécessaire.

---

**PROMPT :**

Tu es un expert en développement de bots de trading et en analyse de données (Data Science/SQL).
Tu reprends le projet **Auto_Polymarket**, un bot de trading automatisé qui tourne sur Railway avec une base de données Supabase.

**État Actuel du Projet :**
1.  **Architecture** : Node.js (Express + WebSocket), Engine de trading modulaire.
2.  **Infrastructure** : Déployé sur Railway, Persistence des données sur Supabase.
3.  **Données** :
    -   L'historique des trades (y compris simulation "Paper Trading") a été synchronisé dans la table `trades` de Supabase via le script `scripts/sync_local_history.js`.
    -   Un fichier SQL `ANALYTICS_VIEWS.sql` a été créé à la racine pour générer des vues d'analyse (PnL, Winrate par catégorie, etc.).

**Ta Mission (Objectifs Prioritaires) :**

1.  **Mise en place de l'Intelligence (Analytics)** :
    -   Si ce n'est pas fait, exécute ou guide-moi pour exécuter `ANALYTICS_VIEWS.sql` dans Supabase.
    -   Crée une nouvelle page ou un endpoint API pour visualiser ces stats (Dashboard Analytics).

2.  **Spécialisation : Expert Sportif** :
    -   Le but est de transformer le bot en "Expert Sport" qui ne parie pas au hasard mais suit la "Smart Money" et les vraies stats.
    -   **Action** : Propose un plan pour intégrer une API de statistiques sportives (ex: API-Football, TheRundown, ou scraping) pour comparer les probabilités implicites de Polymarket avec les stats réelles.
    -   Modifie `engine.js` pour inclure une logique de "Validation Sportive" (ex: Ne pas parier sur une équipe si son joueur star est blessé -> info récupérée via API).

3.  **Amélioration Continue (AI Logging)** :
    -   Met en place un système où le bot logue *pourquoi* il a pris une décision (le `decisionReasons` existe déjà) et *le résultat* (PnL).
    -   Analyse ces logs pour ajuster automatiquement les coefficients de confiance (ex: "Le bot perd souvent sur le Tennis -> Réduire la taille des positions Tennis").

**Ressources à ta disposition :**
-   `PROJECT_STATUS.md` : Vue d'ensemble.
-   `ANALYTICS_VIEWS.sql` : Vues SQL prêtes à l'emploi.
-   `bot_data.json` : Historique local (déjà sync).
-   `src/logic/engine.js` : Cœur du réacteur.

Commence par analyser `ANALYTICS_VIEWS.sql` et propose-moi la première étape pour l'interface Analytics.
