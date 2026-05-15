@echo off
title Nexora Scraper — Switch LinkedIn Account
color 0E
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║     Switch LinkedIn Account                  ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo  This will completely erase the current LinkedIn
echo  session so you can log in with a different account.
echo.
set /p confirm="Type YES and press Enter to confirm: "
if /i not "%confirm%"=="YES" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo Step 1: Closing any open scraper browser windows...
taskkill /F /IM chromium.exe >nul 2>&1
taskkill /F /IM chrome.exe   >nul 2>&1
echo [OK]

echo.
echo Step 2: Clearing LinkedIn session...
cd /d "%~dp0"
node reset-session.js
if %errorlevel% neq 0 (
    echo.
    echo [FAILED] Could not clear session. See error above.
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  Session cleared!                            ║
echo  ║  Double-click start.bat to log in with       ║
echo  ║  your new LinkedIn account.                  ║
echo  ╚══════════════════════════════════════════════╝
echo.
pause
