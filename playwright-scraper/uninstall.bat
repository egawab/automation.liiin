@echo off
echo Removing Nexora scheduled task...
schtasks /Delete /TN "NexoraScraper" /F >nul 2>&1
echo Done. The daily auto-run has been removed.
echo You can still run the scraper manually with start.bat.
echo.
pause
