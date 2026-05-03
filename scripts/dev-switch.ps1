# Switch minspect between local dev and installed npm package.
# Usage:
#   . .\scripts\dev-switch.ps1 local   # use local build
#   . .\scripts\dev-switch.ps1 npm     # use globally installed package

param(
    [ValidateSet("local", "npm", "clear")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"
$MinspectRoot = Split-Path -Parent $PSScriptRoot

if (-not $Mode) {
    $current = if (Get-Command minspect -ErrorAction SilentlyContinue) {
        $globalList = npm list -g --depth=0 2>$null | Out-String
        if ($globalList -match "<-") { "local (linked)" }
        else { "npm (installed)" }
    } else { "none" }
    Write-Host "Current mode: $current"
    Write-Host ""
    Write-Host "Usage: .\scripts\dev-switch.ps1 [local|npm|clear]"
    Write-Host "  local  - build from source, link globally"
    Write-Host "  npm    - install from npm registry"
    Write-Host "  clear  - uninstall only, don't switch"
    return
}

# Step 1: Clean up existing minspect
if (Get-Command minspect -ErrorAction SilentlyContinue) {
    Write-Host "Uninstalling current minspect..."
    try {
        minspect uninstall --all --yes 2>$null
    } catch {
        Write-Host "  (uninstall command failed, continuing)"
    }

    npm uninstall -g @ivenlau/minspect 2>$null
    npm uninstall -g @minspect/cli 2>$null

    # Verify removal
    if (Get-Command minspect -ErrorAction SilentlyContinue) {
        Write-Warning "minspect command still found at: $((Get-Command minspect).Source). Manual cleanup may be needed."
    } else {
        Write-Host "  minspect removed."
    }
}

if ($Mode -eq "clear") {
    Write-Host "Done. minspect uninstalled."
    return
}

# Step 2: Install based on mode
switch ($Mode) {
    "local" {
        Write-Host "Building from source..."
        Push-Location $MinspectRoot
        pnpm -r build
        Push-Location "packages/cli"
        npm link
        Pop-Location
        Pop-Location
        Write-Host "Linked local build."
    }
    "npm" {
        Write-Host "Installing from npm..."
        npm install -g @ivenlau/minspect
        Write-Host "Installed @ivenlau/minspect."
    }
}

# Step 3: Refresh PATH in current session
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

# Step 4: Verify and run init
if (-not (Get-Command minspect -ErrorAction SilentlyContinue)) {
    Write-Error "minspect command not found after install."
    return
}
Write-Host ""
Write-Host "Running minspect init..."
minspect init
