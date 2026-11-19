@echo off
chcp 65001 >nul
cd /d "%~dp0"
title YiWanQi Exam System - Server

echo ============================================
echo   YiWanQi Customer Service Exam System
echo   Starting server on port 3000 ...
echo ============================================

echo [1/4] Stopping old process on port 3000 (if any)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo [2/4] Launching server.js ...
start "ExamServer" cmd /k "node server.js"

echo [3/4] Waiting for server to be ready...
timeout /t 3 /nobreak >nul

echo [4/4] Opening browser...
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" "http://localhost:3000"
) else (
  start "" http://localhost:3000 2>nul
  echo [!] Could not find Edge. Please open http://localhost:3000 manually.
)

echo.
echo Done! If browser did not open, go to: http://localhost:3000
echo Keep the "ExamServer" window open - closing it stops the service.
echo.
timeout /t 5 /nobreak >nul
