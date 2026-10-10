@echo off
rem Lance le site BizCheck sur ton ordinateur : double-clique sur ce fichier.
rem Pour arreter : ferme cette fenetre noire.
cd /d "%~dp0"
echo Site BizCheck : http://localhost:8000
echo Ferme cette fenetre pour arreter le site.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"
python serveur_local.py
