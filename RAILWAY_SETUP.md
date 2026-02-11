# 🚂 Configuration Railway & Logs

Pour que le bot puisse fonctionner correctement et que tu puisses surveiller son activité, suis ce guide.

## 1. Variables d'Environnement (Supabase)

Pour sauvegarder les trades en production :

1. Connecte-toi sur [Railway](https://railway.app).
2. Ouvre ton projet **AUTO_POLYMARKET**.
3. Va dans l'onglet **Variables**.
4. Ajoute :

| Nom de la Variable | Valeur |
|-------------------|--------|
| `SUPABASE_URL`    | `https://locsskuiwhixwwqmsjtm.supabase.co` |
| `SUPABASE_KEY`    | `sb_publishable_eUdyffzMtRSyWm4nZhZYew_AH_7elvg` |

---

## 2. Accéder aux Logs (Surveillance)

Il y a deux façons de voir ce que fait le bot en temps réel.

### Méthode A : Dashboard Railway (Le plus simple)
1. Va sur [Railway.app](https://railway.app).
2. Clique sur ton projet.
3. Clique sur la **brique du service** (celui qui tourne).
4. Ouvre l'onglet **Deployments**.
5. Clique sur le bouton **View Logs** du dernier déploiement.

### Méthode B : En ligne de commande (Pour les pros)
Tu peux voir les logs directement dans ton terminal Windows.

1. **Installer l'outil Railway** (à faire une seule fois) :
   Ouvre PowerShell en mode administrateur et lance :
   ```powershell
   npm install -g @railway/cli
   ```
   *Si tu as une erreur de script, lance cette commande avant :*
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

2. **Se connecter** :
   ```bash
   railway login
   ```

3. **Voir les logs** :
   ```bash
   railway logs
   ```

---

## 3. Logs de Secours (Supabase)
Si Railway est inaccessible, le bot envoie aussi ses logs critiques (erreurs, démarrages) vers Supabase.
Tu peux les lire avec ce script local :

```bash
node scripts/read_remote_logs.js
```
Ajoute `--watch` pour voir en direct :
```bash
node scripts/read_remote_logs.js --watch
```
