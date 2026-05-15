@echo off
title Nexora Scraper — Running
color 0A
cd /d "%~dp0"
if not exist "config.json" ( echo Run install.bat first. & pause & exit /b 1 )
if not exist "node_modules" ( echo Run install.bat first. & pause & exit /b 1 )
echo.
echo  Starting Nexora Scraper...
echo  Close this window to stop at any time.
echo.
node scraper.js
echo.
echo  Done! Check your dashboard for results.
echo.
pause
