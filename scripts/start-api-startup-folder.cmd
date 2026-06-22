@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
set "RUNNER=%ROOT%\scripts\run-api-autostart.cmd"

if not exist "%RUNNER%" (
  echo Runner not found: %RUNNER%
  exit /b 1
)

start "Junhang API" /min "%RUNNER%"
echo API autostart runner launched.
