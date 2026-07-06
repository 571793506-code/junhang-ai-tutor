@echo off
setlocal
cd /d "%~dp0.."
set "API_HOST=0.0.0.0"
echo Starting Junhang API for LAN access on 0.0.0.0:8787
cmd /c npm.cmd run dev --workspace apps/api
