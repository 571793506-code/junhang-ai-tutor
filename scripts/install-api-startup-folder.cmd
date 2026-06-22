@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
set "RUNNER=%ROOT%\scripts\run-api-autostart.cmd"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP_DIR%\JunhangAITutorAPI.vbs"

if not exist "%RUNNER%" (
  echo Runner not found: %RUNNER%
  exit /b 1
)

if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%"

> "%LAUNCHER%" echo Set shell = CreateObject("WScript.Shell")
>> "%LAUNCHER%" echo shell.Run Chr(34) ^& "%RUNNER%" ^& Chr(34), 0, False

echo Startup launcher installed:
echo %LAUNCHER%
echo It will start the API when the current Windows user logs in.
echo To start it now, run: scripts\start-api-startup-folder.cmd
