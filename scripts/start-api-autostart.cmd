@echo off
setlocal
chcp 65001 >nul

set "TASK_NAME=JunhangAITutorAPI"

schtasks /Run /TN "%TASK_NAME%"
if errorlevel 1 (
  echo Failed to start scheduled task: %TASK_NAME%
  echo Install it first: scripts\install-api-autostart.cmd
  exit /b 1
)

echo Scheduled task started: %TASK_NAME%
