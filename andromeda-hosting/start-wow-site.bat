@echo off
title Andromeda Hosting - WotLK website
cd /d "%~dp0"
rem The WotLK website on its own, in a console window. Andromeda Services does the same without one.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First start: installing packages...
  call npm install --omit=dev --no-audit --no-fund
)
echo Starting the WotLK website. Close this window or press Ctrl+C to stop it.
node src\wowsite\index.js
pause
