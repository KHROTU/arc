param(
    [string]$WorkspaceRoot = (Resolve-Path "$PSScriptRoot/..").Path
)
$ErrorActionPreference = "Stop"
$zip = Join-Path $WorkspaceRoot "scripts/playground-clean.zip"
$playground = Join-Path $WorkspaceRoot "playground"
if (-not (Test-Path -LiteralPath $zip)) {
    Write-Error "Archive not found: $zip"
    exit 1
}
if (Test-Path -LiteralPath $playground) {
    Remove-Item -LiteralPath $playground -Recurse -Force
}
Expand-Archive -LiteralPath $zip -DestinationPath $WorkspaceRoot -Force
Write-Host "Playground restored."
