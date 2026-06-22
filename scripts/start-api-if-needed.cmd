@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

node -e "fetch('http://127.0.0.1:8787/api/status').then(r=>r.json()).then(j=>process.exit(j && j.ok !== false ? 0 : 1)).catch(()=>process.exit(1))" >nul 2>nul
if not errorlevel 1 (
  echo Junhang API is already online.
  exit /b 0
)

echo Starting Junhang API...
if not exist "storage\logs" mkdir "storage\logs"
start "Junhang API" /min "%ROOT%\scripts\run-api-autostart.cmd"

for /l %%I in (1,1,20) do (
  node -e "fetch('http://127.0.0.1:8787/api/status').then(r=>r.json()).then(j=>{console.log(JSON.stringify({online:true,ok:j.ok!==false,mode:j.ai&&j.ai.mode},null,2)); process.exit(j && j.ok !== false ? 0 : 1)}).catch(()=>process.exit(1))"
  if not errorlevel 1 exit /b 0
  timeout /t 1 /nobreak >nul
)

echo Junhang API did not become ready within 20 seconds.
exit /b 1
