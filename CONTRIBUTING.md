# Guide de Collaboration — Auto-Polymarket

## Les 3 règles d'or

1. **JAMAIS push directement sur `main`** — c'est la branche production (Railway déploie automatiquement)
2. **Toujours travailler sur SA branche** — `oscar/dev` ou `engue/dev`
3. **Merger via Pull Request** — l'autre personne vérifie avant de fusionner

---

## Qui est qui

| Personne | Branche | Rôle |
|----------|---------|------|
| Oscar | `oscar/dev` | Owner du repo, décisions finales |
| Engue | `engue/dev` | Collaborateur |
| Personne | `main` | PRODUCTION — on n'y touche pas directement |

---

## Workflow quotidien (copier-coller ces commandes)

### 1. Avant de commencer à travailler

```bash
# D'abord, récupérer les dernières modifs de tout le monde
git checkout main
git pull

# Puis mettre à jour ta branche avec le dernier main
git checkout oscar/dev      # ou engue/dev
git merge main
```

Si Git dit "Already up to date" → tout est bon.
Si Git dit "CONFLICT" → **STOP, ne rien forcer** — demander à Claude Code de résoudre.

### 2. Travailler normalement

Modifier le code (avec Claude Code ou à la main), puis :

```bash
git add -A
git commit -m "Description de ce que j'ai fait"
git push
```

### 3. Quand c'est prêt pour la production

Aller sur GitHub → ton repo → **Pull Requests** → **New Pull Request** :
- Base : `main`
- Compare : `oscar/dev` (ou `engue/dev`)
- Écrire ce qui a changé
- **Créer la Pull Request**
- L'autre personne regarde et clique **Merge** si c'est OK

### 4. Après un merge, resynchroniser

```bash
git checkout main
git pull
git checkout oscar/dev      # ou engue/dev
git merge main
git push
```

---

## Ce que Claude Code doit faire à chaque session

Au début de chaque session, Claude Code doit :

1. **Demander qui travaille** : "Tu es Oscar ou Engue ?"
2. **Vérifier la branche active** : `git branch --show-current`
3. **Si on est sur `main`** : basculer sur la bonne branche (`oscar/dev` ou `engue/dev`)
4. **Synchroniser** : `git pull` puis `git merge main` pour avoir les dernières modifs
5. **Vérifier les conflits** avant de commencer

Au moment du push :
1. **Vérifier qu'on n'est PAS sur `main`** — refuser de push si c'est le cas
2. **Push sur la branche perso** uniquement
3. **Proposer de créer une Pull Request** si le changement est prêt pour la production

---

## Résolution de conflits

Un conflit arrive quand Oscar et Engue modifient le même fichier en même temps.

**Comment les éviter :**
- Se dire sur quoi on travaille (ex: "je touche à engine.js aujourd'hui")
- Éviter de modifier les mêmes fichiers en parallèle
- Synchroniser souvent (`git pull` + `git merge main`)

**Quand ça arrive quand même :**
- Git va marquer les lignes en conflit avec `<<<<<<<` et `>>>>>>>`
- Demander à Claude Code : "il y a un conflit, aide-moi à le résoudre"
- Claude Code montrera les deux versions et demandera laquelle garder

---

## Fichiers sensibles

| Fichier | Sur GitHub ? | Pourquoi |
|---------|-------------|----------|
| `.env` | ❌ JAMAIS | Contient les clés API (Supabase, etc.) |
| `bot_data.json` | ❌ Non | Données locales du bot (se reconstruit depuis Supabase) |
| `CLAUDE.md` | ✅ Oui | Instructions pour Claude Code |
| `CONTRIBUTING.md` | ✅ Oui | Ce fichier (guide de collaboration) |
| Tout le reste | ✅ Oui | Code source |

---

## Installation sur un nouvel ordi

```bash
git clone https://github.com/oscardcstudio-cell/AUTO_POLYMARKET.git
cd AUTO_POLYMARKET
npm install
```

Puis coller le fichier `.env` (reçu par message privé) à la racine du projet.

Pour tester : `node server.js` → ouvrir http://localhost:3000
