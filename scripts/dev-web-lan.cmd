@echo off
setlocal
cd /d "%~dp0.."

if not defined LAN_IP (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1 -ExpandProperty IPv4Address).IPAddress"`) do set "LAN_IP=%%I"
)

if not defined LAN_IP (
  echo Unable to detect LAN_IP. Set LAN_IP manually, for example:
  echo set LAN_IP=192.168.3.152
  exit /b 1
)

set "VITE_API_BASE_URL=http://%LAN_IP%:8787"
echo Starting Junhang Web for LAN access.
echo Web URL: http://%LAN_IP%:5173/
echo API URL: %VITE_API_BASE_URL%
pushd apps\web
node ..\..\node_modules\vite\bin\vite.js --host 0.0.0.0
popd
