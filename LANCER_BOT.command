#!/bin/bash
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
echo "🚀 Lancement du bot Auto-Polymarket..."
echo "📊 Dashboard disponible sur http://localhost:3000"
echo "---"
node server.js
