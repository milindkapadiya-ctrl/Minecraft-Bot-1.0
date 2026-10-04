@echo off
cd /d "%~dp0"
".tools\node24\node.exe" --env-file-if-exists=.env dist/src/main.js --movement-demo
pause
