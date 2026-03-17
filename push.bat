@echo off
cd /d C:\Users\Rishi\PROJECTS\RPresearch\deploy
git init -b main
git add -A
git commit -m "Initial deploy of rishiprasad.me portfolio"
git remote add origin https://github.com/BergUetli/rishiprasad.me.git
git push -u origin main
