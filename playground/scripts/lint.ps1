#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "=== Simulated lint ==="
$srcDir = "$PSScriptRoot/../src"
if (Test-Path $srcDir) {
    $issues = 0
    $files = Get-ChildItem $srcDir -File -Include *.ts,*.tsx,*.js,*.css
    foreach ($f in $files) {
        $content = Get-Content $f.FullName -Raw
        if ($content -match "REPLACE_ME") {
            Write-Host "  WARN  $($f.Name): contains REPLACE_ME sentinel"
            $issues++
        }
    }
    if ($issues -eq 0) {
        Write-Host "  OK    No lint issues found."
    } else {
        Write-Host "  Done  $issues warning(s)."
    }
} else {
    Write-Host "  ERR   src/ directory not found."
}
