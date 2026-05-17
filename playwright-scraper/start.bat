@echo off
title Nexora Scraper — Running
color 0A
cd /d "%~dp0"
if not exist "config.json" ( echo Run install.bat first. & pause & exit /b 1 )
if not exist "node_modules" ( echo Run install.bat first. & pause & exit /b 1 )

:menu
cls
echo =========================================
echo       NEXORA SCRAPER - PROFILE MENU
echo =========================================
echo.
echo 1. Continue with current account
echo 2. Log out and sign in to a NEW account
echo 3. Use a custom named profile (e.g., account2)
echo.
set /p CHOICE="Choose an option (1, 2, or 3): "

if "%CHOICE%"=="1" goto run_default
if "%CHOICE%"=="2" goto run_new
if "%CHOICE%"=="3" goto run_custom
goto menu

:run_new
echo.
echo Clearing current profile...
rmdir /s /q "%USERPROFILE%\.nexora_scraper\profile" 2>nul
echo Done! You will be asked to log in again.
goto run_default

:run_custom
echo.
set /p PROFILE_NAME="Enter profile name (e.g., account2): "
if "%PROFILE_NAME%"=="" goto menu
echo.
echo  Starting Nexora Scraper with profile: %PROFILE_NAME%...
echo  Close this window to stop at any time.
echo.
node scraper.js --profile=%PROFILE_NAME%
goto end

:run_default
echo.
echo  Starting Nexora Scraper...
echo  Close this window to stop at any time.
echo.
node scraper.js
goto end

:end
echo.
echo  Done! Check your dashboard for results.
echo.
pause

