@echo off
setlocal
set "WECHAT_DEVTOOLS_COMMAND=compile"
if not "%~1"=="" set "WECHAT_DEVTOOLS_PORT=%~1"
node "%~dp0wechat-devtools-check.mjs"
