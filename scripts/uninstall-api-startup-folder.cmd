@echo off
setlocal
chcp 65001 >nul

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP_DIR%\JunhangAITutorAPI.vbs"

if exist "%LAUNCHER%" (
  del /f /q "%LAUNCHER%"
  echo Removed startup launcher:
  echo %LAUNCHER%
) else (
  echo Startup launcher not found:
  echo %LAUNCHER%
)
