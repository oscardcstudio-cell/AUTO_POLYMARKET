@echo off
echo ===========================================
echo   SAUVEGARDE AUTOMATIQUE VERS GITHUB
echo ===========================================
echo.

:: Preparation des fichiers
echo [+] Preparation des fichiers...
git add .

:: Création de la sauvegarde avec la date et l'heure
set current_date=%date% %time%
echo [+] Creation du point de sauvegarde (%current_date%)...
git commit -m "Mise a jour automatique : %current_date%"

:: Envoi vers GitHub
echo [+] Envoi vers GitHub...
git pull origin main --rebase
git push origin main

echo.
echo ===========================================
echo   TERMINE ! Vos fichiers sont sur GitHub.
echo ===========================================
pause
