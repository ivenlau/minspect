# minspect one-liner installer (Windows PowerShell).
#
#   iwr https://raw.githubusercontent.com/anthropics/minspect/main/scripts/install.ps1 | iex
#
# See scripts/install.sh for the macOS/Linux equivalent — same semantics.
#
# Flags:
#   -Version X    install minspect@X instead of latest
#   -SkipInit     don't print the `minspect init` hint at the end

param(
    [string]$Version = "",
    [switch]$SkipInit
)

$ErrorActionPreference = "Stop"

function Die($msg) {
    Write-Error "minspect install: $msg"
    exit 1
}

function Need($cmd) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Die "required command not found: $cmd"
    }
}

Need node
Need npm

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]" 2>$null)
if ($nodeMajor -lt 20) {
    $v = node -v
    Die "Node.js 20+ required (found $v)"
}

$pkg = if ($Version) { "minspect@$Version" } else { "minspect" }

Write-Host "Installing $pkg via npm..."
# npm on Windows prints progress to stderr; just let it through.
npm install -g $pkg
if ($LASTEXITCODE -ne 0) {
    Die "npm install failed (exit $LASTEXITCODE)"
}

Write-Host ""
Write-Host "minspect installed:"
$binPath = (Get-Command minspect -ErrorAction SilentlyContinue)
if (-not $binPath) {
    Die "minspect not on PATH after install — check 'npm config get prefix'"
}
Write-Host "  $($binPath.Source)"
& minspect --version

if (-not $SkipInit) {
    Write-Host ""
    Write-Host "Next step: run 'minspect init' to detect agents and start the UI."
}
