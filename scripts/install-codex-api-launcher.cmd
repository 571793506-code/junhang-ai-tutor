@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
set "DESKTOP=%USERPROFILE%\Desktop"
set "TARGET=%DESKTOP%\君航Codex启动API.cmd"

if not exist "%DESKTOP%" (
  echo Desktop folder not found: %DESKTOP%
  exit /b 1
)

> "%TARGET%" echo @echo off
>> "%TARGET%" echo call "%ROOT%\scripts\open-codex-with-api.cmd"

echo Launcher created:
echo %TARGET%
