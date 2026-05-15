@echo off
title Nexora Scraper — Setup
color 0A
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║     Nexora Playwright Scraper — Setup        ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo  This will set up everything you need.
echo  This only needs to be done ONCE.
echo.
pause

:: ── Refresh PATH from registry (no restart needed) ─────────────────────────
:: Reads system PATH + user PATH directly from Windows registry at runtime.
:: This means Node.js installed moments ago is immediately visible.
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USR_PATH=%%B"
set "PATH=%SYS_PATH%;%USR_PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm"

:: ── Check Node.js ──────────────────────────────────────────────────────────
echo.
echo [1/4] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [!] Node.js was not found.
    echo.
    echo  If you just installed it, close this window and
    echo  double-click install.bat again to start fresh.
    echo.
    echo  If you have NOT installed Node.js yet:
    echo    1. Go to:  https://nodejs.org
    echo    2. Click "Download Node.js (LTS)"
    echo    3. Run the installer — click Next, Next, Finish
    echo    4. Close this window and double-click install.bat again
    echo.
    pause
    exit /b 1
)
echo  [OK] Node.js found: 
node --version

:: ── Install npm packages ────────────────────────────────────────────────────
echo.
echo [2/4] Installing packages (Playwright)...
echo  This may take 1-2 minutes on first run.
echo.
cd /d "%~dp0"
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
)
echo  [OK] Packages installed.

:: ── Download Playwright browser (Chromium) ──────────────────────────────────
echo.
echo [3/4] Downloading browser (Chromium ~150MB — one time only)...
echo  Please wait, this may take a few minutes...
echo.
call npx playwright install chromium
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Browser download failed. Check your internet connection and try again.
    pause
    exit /b 1
)
echo  [OK] Browser ready.

:: ── Run interactive config setup ─────────────────────────────────────────────
echo.
echo [4/4] Configuration...
echo.
call node setup.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Setup did not complete. Please try again.
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  Setup complete!                             ║
echo  ║  Double-click start.bat to run the scraper. ║
echo  ╚══════════════════════════════════════════════╝
echo.
pause
