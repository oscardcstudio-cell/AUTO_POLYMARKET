# 🚀 Déploiement Railway - Bot Polymarket

## Préparation du projet

Votre projet est maintenant prêt pour le déploiement sur Railway !

## Instructions de déploiement

### 1. Créer un compte Railway
- Allez sur [railway.app](https://railway.app)
- Connectez-vous avec votre compte GitHub

### 2. Déployer le projet

#### Option A: Via GitHub (Recommandé)
1. Poussez votre code sur GitHub:
   ```bash
   git add .
   git commit -m "Prepare for Railway deployment"
   git push
   ```

2. Sur Railway:
   - Cliquez sur "New Project"
   - Sélectionnez "Deploy from GitHub repo"
   - Choisissez votre repository `Auto_Polymarket`
   - Railway démarrera automatiquement le déploiement

#### Option B: Via Railway CLI
1. Installez Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```

2. Connectez-vous:
   ```bash
   railway login
   ```

3. Initialisez et déployez:
   ```bash
   railway init
   railway up
   ```

### 3. Configuration

Railway détectera automatiquement:
- ✅ Node.js (version >=18)
- ✅ `npm install` pour les dépendances
- ✅ `npm start` pour lancer le bot

### 4. Accéder au dashboard

Une fois déployé, Railway vous donnera une URL publique (ex: `https://your-app.railway.app`).

Votre dashboard sera accessible directement à cette URL !

## Monitoring

- **Health check**: `https://your-app.railway.app/health`
- **Logs**: Consultez les logs directement dans le dashboard Railway
- **Redémarrage automatique**: Le bot redémarre automatiquement en cas d'erreur

## Notes importantes

⚠️ **Persistance des données**: 
- `bot_data.json` sera perdu à chaque redémarrage
- Pour persister les données, il faudra ajouter une database (PostgreSQL/MongoDB)

💰 **Coûts**:
- Railway offre $5/mois de crédit gratuit
- Votre bot consommera environ $2-3/mois

## Support

En cas de problème, vérifiez:
1. Les logs Railway pour les erreurs
2. Que toutes les dépendances sont installées
3. L'endpoint `/health` renvoie un status OK
