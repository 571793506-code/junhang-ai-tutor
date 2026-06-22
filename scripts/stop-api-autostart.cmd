@echo off
setlocal
chcp 65001 >nul

set "TASK_NAME=JunhangAITutorAPI"

schtasks /End /TN "%TASK_NAME%" >nul 2>nul

for /f "skip=1 tokens=1" %%P in ('wmic process where "CommandLine like '%%run-api-autostart.cmd%%'" get ProcessId 2^>nul') do (
  if not "%%P"=="" (
    echo Stopping API runner tree: %%P
    taskkill /F /T /PID %%P >nul 2>nul
  )
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
  echo Stopping process on port 8787: %%P
  taskkill /F /PID %%P >nul 2>nul
)

echo API autostart task stopped if it was running.
