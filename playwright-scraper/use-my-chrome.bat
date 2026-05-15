@echo off
title Nexora — Select Chrome Profile & Run
color 0A
cd /d "%~dp0"
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   Nexora — Run With My Chrome Account        ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: Step 1: Pick which Chrome profile to use
node pick-profile.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Profile selection failed.
    pause
    exit /b 1
)

:: Step 2: Close Chrome so the scraper can open it with the debugging port.
:: The scraper will relaunch it automatically.
echo.
echo Closing Chrome...
taskkill /IM chrome.exe >nul 2>&1
timeout /t 4 /nobreak >nul
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo [OK] Ready.

echo.
echo Starting scraper...
echo (Chrome will open automatically with the selected account)
echo.

:: Step 3: Run scraper — it launches Chrome via CDP and attaches to it
node scraper.js --real-chrome

echo.
echo  Done! Check your dashboard for results.
echo.
pause
