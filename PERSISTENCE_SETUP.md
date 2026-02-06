# 💾 Guide de Persistance (Railway & GitHub)

Pour éviter que votre bot ne perde son historique et son argent à chaque redémarrage, suivez ces étapes.

## Option 1: Volume Railway (Recommandé +++)
C'est la méthode la plus fiable. Vos données sont stockées sur un disque virtuel permanent.

1.  **Créer un Volume dans Railway** :
    *   Allez dans votre projet Railway.
    *   Faites un clic droit sur le canvas (vide) ou cliquez sur "New" -> **Volume**.
    *   Attachez ce volume à votre service `Auto_Polymarket`.

2.  **Configurer le "Mount Path"** :
    *   Dans les paramètres du Volume, définissez le **Mount Path** sur `/data` (ou `/app/data`).

3.  **Configurer la Variable d'Environnement** :
    *   Dans les **Variables** de votre service `Auto_Polymarket`.
    *   Ajoutez une variable :
        *   **Name**: `STORAGE_PATH`
        *   **Value**: `/data/bot_data.json` (ou `/app/data/bot_data.json` selon votre Mount Path).

**Résultat** : Le bot enregistrera `bot_data.json` directement sur ce disque dur virtuel. Il ne sera jamais effacé.

---

## Option 2: GitHub Auto-Sync (Backup)
Le bot sauvegarde aussi ses données sur GitHub. C'est utile comme backup ou pour voir les données depuis votre ordi.

1.  **Vérifiez vos variables** :
    *   `GH_TOKEN`: Votre token d'accès GitHub (droit `repo`).
    *   `GH_REPO`: Le nom de votre repo (ex: `Auto_Polymarket`).
    *   `GH_OWNER`: Votre pseudo GitHub.

**Amélioration Activée** : J'ai mis à jour le code pour forcer une sauvegarde vers GitHub **immédiatement après chaque trade**.

---

## Vérification
Au prochain redémarrage, regardez les logs du bot. Vous devriez voir :
```
💾 PERSISTENCE PATH: /data/bot_data.json
✅ Using Custom Storage Path (Volume): /data/bot_data.json
```
Si vous voyez ça, c'est gagné ! vos données sont en sécurité.
