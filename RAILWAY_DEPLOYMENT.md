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

## Monitoring & Logs 🕵️‍♂️

### 1. Via le Dashboard Railway (Facile)
- Allez dans votre projet sur Railway.
- Cliquez sur le service actif.
- Allez dans l'onglet **"Logs"**.
- Vous verrez le flux en direct.

### 2. Via le Terminal (Pro)
Pour voir les logs directement dans votre terminal local :

1. Installez le CLI Railway :
   ```bash
   npm i -g @railway/cli
   ```
   *Note : Si vous avez une erreur de script sur Windows PowerShell, lancez d'abord :*
   `Set-ExecutionPolicy RemoteSigned - Scope CurrentUser`

2. Connectez-vous :
   ```bash
   railway login
   ```

3. Affichez les logs :
   ```bash
   railway logs
   ```

### 3. Logs de Secours (Supabase)
Si Railway est inaccessible, le bot sauvegarde les événements critiques dans Supabase.
Utilisez le script inclus pour les lire :
```bash
node scripts/read_remote_logs.js
```

### Redémarrage
- Le bot redémarre automatiquement en cas d'erreur critique.
- Vous pouvez forcer un redémarrage depuis le dashboard Railway (Command Palette > Restart).

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
