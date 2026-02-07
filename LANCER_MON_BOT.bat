@echo off
title Polymarket Trading Bot - LIVE
echo ==========================================
echo    LANCEMENT DU BOT POLYMARKET + DASHBOARD
echo ==========================================
echo.
echo [1/2] Nettoyage des anciennes instances...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do taskkill /f /pid %%a 2>nul
echo [2/2] Demarrage du bot...
echo.
node server.js
pause
