@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

if "%JUNHANG_API_AUTOSTART_LOG_DIR%"=="" (
  set "LOG_DIR=%LOCALAPPDATA%\JunhangAITutor\logs"
) else (
  set "LOG_DIR=%JUNHANG_API_AUTOSTART_LOG_DIR%"
)
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "LOG_FILE=%LOG_DIR%\api-autostart.log"

echo ==================================================>> "%LOG_FILE%"
echo [%date% %time%] Junhang API autostart runner booted.>> "%LOG_FILE%"
echo Project root: %ROOT%>> "%LOG_FILE%"

:loop
echo [%date% %time%] Starting API...>> "%LOG_FILE%"
call "%ROOT%\jh.cmd" start:api >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
echo [%date% %time%] API exited with code %EXIT_CODE%; restart in 8 seconds.>> "%LOG_FILE%"
timeout /t 8 /nobreak >nul
goto loop
