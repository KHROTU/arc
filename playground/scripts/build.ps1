#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "=== Simulated build ==="
Write-Host "Running for file.edit / file.write runAfter testing."
Write-Host ""

$srcDir = "$PSScriptRoot/../src"
if (Test-Path $srcDir) {
    $files = Get-ChildItem $srcDir -File | Sort-Object Name
    Write-Host "Files in src/:"
    foreach ($f in $files) {
        Write-Host "  $($f.Name) ($($f.Length) bytes)"
    }
}
Write-Host ""
Write-Host "Build complete (simulated)."
