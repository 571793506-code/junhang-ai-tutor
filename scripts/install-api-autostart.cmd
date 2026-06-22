@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
set "TASK_NAME=JunhangAITutorAPI"
set "RUNNER=%ROOT%\scripts\run-api-autostart.cmd"

if not exist "%RUNNER%" (
  echo Runner not found: %RUNNER%
  exit /b 1
)

schtasks /Create /TN "%TASK_NAME%" /TR "\"%RUNNER%\"" /SC ONLOGON /F
if errorlevel 1 (
  echo Failed to create scheduled task: %TASK_NAME%
  exit /b 1
)

echo Scheduled task installed: %TASK_NAME%
echo It will start the API when the current Windows user logs in.
echo To start it now, run: scripts\start-api-autostart.cmd
