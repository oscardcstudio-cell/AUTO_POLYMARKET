# 🚂 Configuration Railway pour Supabase

Pour que le bot puisse sauvegarder tes trades en production (Railway) de manière sécurisée, tu dois ajouter deux variables d'environnement.

## Étapes

1. Connecte-toi sur [Railway](https://railway.app).
2. Ouvre ton projet **AUTO_POLYMARKET**.
3. Va dans l'onglet **Variables**.
4. Clique sur **New Variable** et ajoute :

| Nom de la Variable | Valeur |
|-------------------|--------|
| `SUPABASE_URL`    | `https://locsskuiwhixwwqmsjtm.supabase.co` |
| `SUPABASE_KEY`    | `sb_publishable_eUdyffzMtRSyWm4nZhZYew_AH_7elvg` |

## Validation

Une fois ajoutées, Railway va redémarrer automatiquement le bot.
Tu verras dans les logs :
> `✅ Service Connecté !` (ou équivalent)
Au lieu du warning :
> `⚠️ WARNING: Supabase credentials missing...`

C'est tout ! Ton bot est maintenant sécurisé. 🔒
