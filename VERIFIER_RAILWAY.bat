@echo off
title Diagnostic Railway Bot - Auto-Refresh
color 0A
echo ==========================================
echo    DIAGNOSTIC RAILWAY - AUTO-REFRESH
echo ==========================================
echo.
echo Ce script verifie l'etat du bot sur Railway
echo et se rafraichit toutes les 30 secondes.
echo.
echo Appuyez sur CTRL+C pour arreter.
echo ==========================================
echo.

:loop
echo.
echo [%date% %time%] Verification en cours...
echo.
node scripts/diagnose_railway_state.js
echo.
echo ==========================================
echo Prochaine verification dans 30 secondes...
echo ==========================================
timeout /t 30 /nobreak >nul
goto loop
