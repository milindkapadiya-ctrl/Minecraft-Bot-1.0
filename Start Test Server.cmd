@echo off
cd /d "%~dp0"
".tools\node24\node.exe" scripts/test-server.mjs
pause
