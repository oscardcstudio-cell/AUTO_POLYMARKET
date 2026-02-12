@echo off
title 🤖 NEURAL TRADER - Bot Polymarket
color 0B
echo ========================================================
echo.
echo    [ NEURAL TRADER DASHBOARD - STARTUP ]
echo.
echo ========================================================
echo.
echo [1/2] Nettoyage des anciennes instances (Port 3000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do taskkill /f /pid %%a 2>nul
echo.
echo [2/2] Demarrage du moteur Neuronal...
echo.
echo --------------------------------------------------------
echo    DASHBOARD  : http://localhost:3000
echo    ANALYTICS  : http://localhost:3000/analytics
echo    ARCHI MAP  : http://localhost:3000/architecture
echo --------------------------------------------------------
echo.
node server.js
pause

