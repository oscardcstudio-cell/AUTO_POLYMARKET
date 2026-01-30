import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Servir les fichiers statiques
app.use(express.static(__dirname));

// Rediriger la racine vers le dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot_dashboard.html'));
});

// API pour récupérer les données du bot
app.get('/api/bot-data', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Éviter les erreurs CORS
    try {
        const data = fs.readFileSync(path.join(__dirname, 'bot_data.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: "Fichier de données introuvable" });
    }
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              DASHBOARD SERVEUR DÉMARRÉ                     ║
╚════════════════════════════════════════════════════════════╝

🌐 Ouvrez votre navigateur à l'adresse:
   http://localhost:${PORT}/bot_dashboard.html

📊 Le dashboard se met à jour automatiquement toutes les 10 secondes
🤖 Le bot tourne en parallèle dans l'autre terminal

Pour arrêter: Ctrl+C
`);
});
