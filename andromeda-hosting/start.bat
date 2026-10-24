@echo off
title Andromeda Hosting
cd /d "%~dp0"
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
rem Lets the panel restart itself after installing an update.
set ANDROMEDA_LAUNCHER=1
:run
echo Starting Andromeda Hosting. Close this window or press Ctrl+C to stop the panel (running game servers are saved and stopped first).
node src\index.js
if %errorlevel%==75 (
  echo Restarting Andromeda Hosting after an update...
  goto run
)
pause
