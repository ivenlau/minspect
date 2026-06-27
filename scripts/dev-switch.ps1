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

# Resolve the minspect state dir. The CLI defaults to
# %LOCALAPPDATA%\minspect on Windows; we read it directly so we can
# preserve the user's prior autostart intent across the switch.
$StateDir = Join-Path $env:LOCALAPPDATA "minspect"
$ConfigPath = Join-Path $StateDir "config.json"

# Capture the autostart flag before we run uninstall --all, which would
# otherwise flip it to false. After the switch we'll restore the user's
# choice by re-running `install-autostart` only when they originally
# had it enabled — explicit opt-out means explicit opt-out.
$AutostartWasEnabled = $false
if (Test-Path $ConfigPath) {
    try {
        $cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.autostart -eq $true) { $AutostartWasEnabled = $true }
    } catch {
        # Malformed config — treat as "no preference", don't auto-re-register.
    }
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
    # `uninstall --all` above set `autostart: false` in config.json. That's
    # truthful right now (nothing is installed) but it'd also suppress the
    # autostart prompt on the next `minspect init` (init only asks when
    # `cfg.autostart === undefined`). Drop the field so a future install
    # gets a clean "have you decided?" pass instead of inheriting our
    # temporary off-state. Leave `auto_spawn_daemon` alone — that one
    # captures an ongoing user preference, not a per-install fact.
    if (Test-Path $ConfigPath) {
        try {
            $cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($cfg.PSObject.Properties["autostart"]) {
                $cfg.PSObject.Properties.Remove("autostart")
                $cfg | ConvertTo-Json | Set-Content $ConfigPath -Encoding UTF8
                Write-Host "Cleared autostart field from config.json."
            }
        } catch {
            # Malformed config — leave it alone.
        }
    }
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

# Step 5: Re-register autostart if the user originally had it enabled.
#
# `init` won't do this on its own: `uninstall --all` flipped
# `cfg.autostart` to false in step 1, and init's autostart question
# is gated on `cfg.autostart === undefined`. So without this step the
# Task Scheduler task / launchd agent / systemd --user unit is gone
# for good and the daemon won't come back on next login.
#
# If the user had explicitly disabled autostart before the switch,
# we honour that and skip re-registration.
if ($AutostartWasEnabled) {
    Write-Host ""
    Write-Host "Re-registering autostart (was enabled before switch)..."
    try {
        minspect install-autostart
    } catch {
        Write-Warning "install-autostart failed: $_. Run 'minspect doctor' to diagnose."
    }
}