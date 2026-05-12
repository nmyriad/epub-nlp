# epub-nlp update script
# Run this from inside your epub-nlp folder to apply the latest changes
# Usage: Right-click PowerShell → Run, then: cd C:\Users\James\epub-nlp && .\update.ps1

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   epub-nlp Updater" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check we're in the right folder ────────────────────────────────
if (-not (Test-Path "package.json")) {
    Write-Host "Error: Run this script from inside your epub-nlp folder." -ForegroundColor Red
    Write-Host "Example: cd C:\Users\James\epub-nlp" -ForegroundColor Yellow
    exit 1
}

# ── Step 2: Pull latest code from GitHub ──────────────────────────────────
Write-Host "Pulling latest changes from GitHub..." -ForegroundColor Yellow
git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "Git pull failed. Check your internet connection or run 'git status'." -ForegroundColor Red
    exit 1
}
Write-Host "  Done." -ForegroundColor Green

# ── Step 3: Install any new dependencies ──────────────────────────────────
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Done." -ForegroundColor Green

# ── Step 4: Show current version ──────────────────────────────────────────
Write-Host ""
$version = node src/index.js --version 2>$null
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   epub-nlp is up to date! (v$version)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To launch the UI, run:" -ForegroundColor White
Write-Host "  node src/index.js ui" -ForegroundColor Yellow
Write-Host ""
