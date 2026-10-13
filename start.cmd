@echo off
cd /d "%~dp0"
title Build Album
node --use-system-ca server.js
pause
