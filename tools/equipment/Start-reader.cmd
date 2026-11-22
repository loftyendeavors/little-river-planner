@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then double-click this file again.
  pause
  exit /b 1
)
if not exist equipment.env (
  copy /Y "equipment.env.example" "equipment.env" >nul
  echo Enter your Ecowitt details in equipment.env, save it, then run this file again.
  start "" notepad.exe equipment.env
  pause
  exit /b 0
)
node --env-file=equipment.env equipment-reader.mjs
pause
