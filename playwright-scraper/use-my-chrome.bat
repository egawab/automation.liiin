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

:: The scraper will use an isolated profile, so your main Chrome can stay open.
echo.
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
