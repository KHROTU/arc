#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "=== Arc Playground Demo ==="
Write-Host "Date : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "CWD  : $(Get-Location)"
Write-Host "User : $env:USERNAME"
Write-Host ""

Write-Host "--- playground/src/ ---"
Get-ChildItem "$PSScriptRoot/../src" | Format-Table Name, Length, LastWriteTime
Write-Host ""

Write-Host "--- playground/data/ ---"
Get-ChildItem "$PSScriptRoot/../data" | Format-Table Name, Length, LastWriteTime
Write-Host ""

Write-Host "--- Config contents (first 3 lines) ---"
Get-Content "$PSScriptRoot/../src/config.json" -TotalCount 3
Write-Host ""

Write-Host "=== Done ==="
