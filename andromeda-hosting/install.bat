@echo off
title Andromeda Hosting setup
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
echo Using Node.js
node -v
echo Installing Andromeda Hosting dependencies...
call npm install --omit=dev
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)
if not exist config.json copy config.example.json config.json >nul
echo.
echo Done! Edit config.json if you want server files on another drive, then run start.bat
pause
