@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1

if "%~1"=="" (
  echo Usage: jh.cmd ^<npm-script^> [args...]
  echo Example: jh.cmd check:api
  echo Example: jh.cmd dev:api
  exit /b 1
)

npm.cmd run %*
exit /b %ERRORLEVEL%
