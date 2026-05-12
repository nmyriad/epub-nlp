# epub-nlp installer script for Windows
# Run this in PowerShell as Administrator
# Right-click PowerShell → "Run as Administrator" → paste this command:
# irm https://raw.githubusercontent.com/nmyriad/epub-nlp/main/install.ps1 | iex

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   epub-nlp Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check for winget ───────────────────────────────────────────────
Write-Host "Checking for winget..." -ForegroundColor Yellow
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget not found. Please install it from the Microsoft Store (App Installer) and re-run this script." -ForegroundColor Red
    exit 1
}
Write-Host "  winget found." -ForegroundColor Green

# ── Step 2: Install Node.js ────────────────────────────────────────────────
Write-Host ""
Write-Host "Checking for Node.js..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Host "  Node.js already installed: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "  Installing Node.js LTS..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  Node.js installed." -ForegroundColor Green
}

# ── Step 3: Install Git ────────────────────────────────────────────────────
Write-Host ""
Write-Host "Checking for Git..." -ForegroundColor Yellow
if (Get-Command git -ErrorAction SilentlyContinue) {
    $gitVersion = git --version
    Write-Host "  Git already installed: $gitVersion" -ForegroundColor Green
} else {
    Write-Host "  Installing Git..." -ForegroundColor Yellow
    winget install Git.Git --silent --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  Git installed." -ForegroundColor Green
}

# ── Step 4: Clone the repo ─────────────────────────────────────────────────
Write-Host ""
Write-Host "Downloading epub-nlp..." -ForegroundColor Yellow
$installPath = "$env:USERPROFILE\epub-nlp"

if (Test-Path $installPath) {
    Write-Host "  epub-nlp folder already exists at $installPath" -ForegroundColor Yellow
    Write-Host "  Pulling latest updates..." -ForegroundColor Yellow
    Set-Location $installPath
    git pull
} else {
    git clone https://github.com/nmyriad/epub-nlp.git $installPath
    Set-Location $installPath
    Write-Host "  Downloaded to $installPath" -ForegroundColor Green
}

# ── Step 5: Install dependencies ──────────────────────────────────────────
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
Write-Host "  Dependencies installed." -ForegroundColor Green

# ── Step 6: Done ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   All done! epub-nlp is ready." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To analyze a book, run:" -ForegroundColor White
Write-Host "  cd $installPath" -ForegroundColor Yellow
Write-Host "  node src/index.js analyze `"Books\your-book.epub`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "To export to Anki:" -ForegroundColor White
Write-Host "  node src/index.js db export-anki" -ForegroundColor Yellow
Write-Host ""
Write-Host "Full instructions: https://github.com/nmyriad/epub-nlp" -ForegroundColor Cyan
Write-Host ""
