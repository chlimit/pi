@echo off
setlocal
node "%~dp0packages\desktop\scripts\start.mjs" %*
exit /b %ERRORLEVEL%
