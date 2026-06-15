#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "=== Simulated test run ==="
$dataDir = "$PSScriptRoot/../data"

Write-Host "Checking data files..."
if (Test-Path "$dataDir/sample.json") {
    $json = Get-Content "$dataDir/sample.json" -Raw | ConvertFrom-Json
    Write-Host "  OK    sample.json: $($json.name) — $($json.version)"
} else {
    Write-Host "  ERR   sample.json not found."
}

if (Test-Path "$dataDir/todo.txt") {
    $lines = (Get-Content "$dataDir/todo.txt").Count
    Write-Host "  OK    todo.txt: $lines lines"
} else {
    Write-Host "  ERR   todo.txt not found."
}

if (Test-Path "$dataDir/urls.txt") {
    $lines = (Get-Content "$dataDir/urls.txt").Count
    Write-Host "  OK    urls.txt: $lines lines"
} else {
    Write-Host "  ERR   urls.txt not found."
}

Write-Host "All checks complete."
