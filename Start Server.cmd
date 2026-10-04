@echo off
cd /d "%~dp0server-26.1"
for /d %%J in ("%~dp0.tools\java25\*") do "%%~J\bin\java.exe" -Xms1G -Xmx2G -jar server.jar nogui
pause
