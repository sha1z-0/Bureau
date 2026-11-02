@echo off
setlocal
cd /d "%~dp0"
title Bureau

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Already running in the background (Start with Windows)? Just open it.
curl -s -o nul --max-time 2 http://127.0.0.1:4317/api/health && (
  start "" "http://127.0.0.1:4317"
  exit /b 0
)

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install || (pause & exit /b 1)
)

echo Building the interface...
call npm run build --silent || (pause & exit /b 1)

echo.
echo  Bureau is running at http://127.0.0.1:4317  -  close this window to stop it.
echo.
set BUREAU_OPEN=1
call npx tsx server/index.ts
