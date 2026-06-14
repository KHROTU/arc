#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "Interactive script started."
Write-Host "Waiting for input..."

$name = Read-Host "Enter your name"

Write-Host "Hello, $name! Welcome to the Arc background process test."
Write-Host "Interactive script complete."
