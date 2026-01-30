# 🌐 Guide : Faire tourner le bot 24h/24 (Cloud Hosting)

Pour que le bot continue de parier même quand ton ordinateur est éteint, tu dois le mettre sur un **serveur (Cloud)**. Voici les meilleures options simples :

## 1. Option Facile : Railway.app ou Render.com
Ces plateformes sont parfaites pour les bots Node.js.
1. Crée un compte sur [Railway.app](https://railway.app/).
2. Connecte ton GitHub (où tu as mis ton code) ou upload les fichiers directement.
3. Railway détectera automatiquement le `package.json` et lancera `node unified_bot.js`.
4. **Avantage :** C'est gratuit (ou très peu cher) et ça ne s'arrête jamais.

## 2. Option Pro : VPS (DigitalOcean / AWS / OVH)
C'est comme avoir un petit ordinateur Windows ou Linux allumé chez un hébergeur.
1. Tu loues un VPS (environ 5$/mois).
2. Tu installes Node.js dessus.
3. Tu lances le bot avec un outil appelé `pm2` qui relance le bot s'il plante.
   ```bash
   npm install pm2 -g
   pm2 start unified_bot.js
   ```

## ⚠️ Pourquoi c'est écrit "OFFLINE" actuellement ?
Si tu vois "OFFLINE" sur ton dashboard actuel, c'est probablement parce que :
1. **Le bot sur ton PC est arrêté :** Tu dois relancer `unified_bot.js` avec la commande `node unified_bot.js`.
2. **Le navigateur ne trouve pas le serveur :** Vérifie que tu es bien sur `http://localhost:3000` et non sur un fichier `C:\Users\...index.html`.
3. **Erreur Réseau :** Si le bot n'a pas pu contacter Polymarket durant les dernières minutes, il s'affiche en OFFLINE par sécurité.

---

### Prochaines étapes suggérées :
- Je vais mettre à jour ton fichier `LANCER_MON_BOT.bat` pour qu'il soit plus fiable.
- Je vais ajouter une indication de "Dernière Synchronisation" sur le dashboard pour voir si le bot est juste en train de "dormir" ou s'il est vraiment planté.
