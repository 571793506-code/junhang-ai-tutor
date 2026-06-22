@echo off
setlocal
chcp 65001 >nul

set "TASK_NAME=JunhangAITutorAPI"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP_DIR%\JunhangAITutorAPI.vbs"

echo Scheduled task:
schtasks /Query /TN "%TASK_NAME%" /FO LIST 2>nul
if errorlevel 1 (
  echo Not installed: %TASK_NAME%
)

echo.
echo Startup folder launcher:
if exist "%LAUNCHER%" (
  echo Installed: %LAUNCHER%
) else (
  echo Not installed: %LAUNCHER%
)

echo.
echo HKCU Run registry:
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "JunhangAITutorAPI" 2>nul
if errorlevel 1 (
  echo Not installed: JunhangAITutorAPI
)

echo.
echo API status:
node -e "fetch('http://127.0.0.1:8787/api/status').then(r=>r.json()).then(j=>console.log(JSON.stringify({online:true,ok:j.ok!==false,mode:j.ai&&j.ai.mode},null,2))).catch(e=>{console.log(JSON.stringify({online:false,error:e.message},null,2)); process.exitCode=1})"

echo.
echo Port 8787:
netstat -ano | findstr ":8787"
