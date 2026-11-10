@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
set "MCBOT_NODE=node.exe"
where node.exe >nul 2>nul
if not errorlevel 1 goto run
set "MCBOT_NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%MCBOT_NODE%" goto run
echo Node.js was not found. Installations and security settings were not changed.
echo See docs\dashboard-guide.md for the existing-runtime fallback.
pause
exit /b 1
:run
"%MCBOT_NODE%" "%~dp0scripts\dashboard-launch.mjs"
if not errorlevel 1 exit /b 0
echo Dashboard startup or shutdown failed. Read the message above.
pause
exit /b 1
