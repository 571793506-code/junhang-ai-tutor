$ErrorActionPreference = "Stop"

chcp 65001 | Out-Null
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$env:PYTHONUTF8 = "1"
$env:NODE_OPTIONS = (($env:NODE_OPTIONS, "--enable-source-maps") -join " ").Trim()

Write-Host "Windows terminal encoding is set to UTF-8 for this session."
Write-Host "Use npm.cmd instead of npm in PowerShell, or use the project scripts which route npm through scripts/run-with-env.mjs."
