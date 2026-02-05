# Configuration GitHub Auto-Sync pour Railway

## Étape 1: Créer un Token GitHub

1. Allez sur **GitHub** → **Settings** (votre profil)
2. **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. **Generate new token (classic)**
4. **Nom**: `Railway Polymarket Bot`
5. **Scopes** (cochez):
   - ✅ `repo` (Full control of private repositories)
6. **Generate token**
7. **COPIEZ LE TOKEN** (vous ne le reverrez plus !)

---

## Étape 2: Configurer Railway

1. Allez dans **Railway** → Votre projet **AUTO_POLYMARKET**
2. **Settings** → **Variables** (ou Environment)
   - **Nom**: `GH_TOKEN`
   - **Valeur**: `votre_token_github_copié`
4. **(Optionnel) Ajoutez une variable pour le repo** :
   - Si votre repo ne s'appelle pas `Auto_Polymarket`, ajoutez :
   - **Nom**: `GH_REPO`
   - **Valeur**: `NomDeVotreRepo`
5. **Sauvegardez**

---

## Étape 3: Modifier le Code (Automatique)

Le code a déjà été modifié pour utiliser le token. Railway va:
- Auto-commit `bot_data.json` toutes les 5 minutes
- Utiliser le token pour push sur GitHub
- Sauvegarder: Capital, Trades actifs, Historique

---

## Étape 4: Pousser le Code

Les modifications sont prêtes. On va pousser sur GitHub maintenant.

---

## Comment ça marche ?

### Au démarrage
```
Bot démarre → Charge bot_data.json depuis GitHub (dernier state)
```

### Toutes les 5 minutes
```
Sauvegarde state → git commit → git push
```

### Si Railway redémarre
```
Redémarre → Charge le dernier bot_data.json → Continue où il était
```

---

## Vérification

Après déploiement, vous verrez dans les logs Railway:
```
💾 Données sauvegardées sur GitHub
```

Et sur GitHub, des commits automatiques:
```
Auto-save: Capital $950.00 | Trades: 1
```

---

## Important ⚠️

- Le token donne accès à vos repos → **GARDEZ-LE SECRET**
- Ne commitez JAMAIS le token dans le code
- Utilisez UNIQUEMENT les variables d'environnement Railway
