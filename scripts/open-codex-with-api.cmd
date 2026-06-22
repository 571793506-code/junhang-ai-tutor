@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
set "CODEX_APP=shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"

cd /d "%ROOT%"

call "%ROOT%\scripts\start-api-if-needed.cmd"
if errorlevel 1 (
  echo API failed to start. Codex will still open, but local API features may be unavailable.
)

explorer.exe "%CODEX_APP%"
exit /b 0
