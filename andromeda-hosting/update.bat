@echo off
title Andromeda Hosting update
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Get it from https://git-scm.com/download/win and run this again.
  pause
  exit /b 1
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo This folder isn't a Git copy of the repository yet. See "Updating" in README.md.
  pause
  exit /b 1
)
rem Update to whatever branch this folder was cloned on (e.g. HomePanel), from its own remote.
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo Downloading the latest version of branch "%BRANCH%"...
git fetch origin %BRANCH%
if errorlevel 1 (
  echo.
  echo Download failed - see the message above. If it asks for a password, your repo is private:
  echo make it public on GitHub, or use a Personal Access Token (github.com/settings/tokens).
  pause
  exit /b 1
)
rem Match the remote exactly. Your data folder and config.json are untracked, so they are kept.
git reset --hard FETCH_HEAD
if errorlevel 1 (
  echo Update failed - see the message above.
  pause
  exit /b 1
)
echo Installing any new packages...
call npm install --omit=dev --no-audit --no-fund
echo.
echo Done. If Andromeda Hosting is running, close its window and start it again with start.bat.
echo (Your servers, settings and accounts in the data folder are kept.)
pause
