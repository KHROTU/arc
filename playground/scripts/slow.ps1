#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "Starting slow operation..."
Write-Host "This script deliberately takes time to exercise the shell.run timeout parameter."

$steps = 10
for ($i = 1; $i -le $steps; $i++) {
    Write-Host "Step $i / $steps"
    Start-Sleep -Seconds 1
}

Write-Host "Slow operation complete."
Write-Host "If you see this, the timeout was generous enough or disabled (-1)."
