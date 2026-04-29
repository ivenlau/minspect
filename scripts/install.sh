#!/bin/sh
# minspect one-liner installer (macOS / Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/ivenlau/minspect/main/scripts/install.sh | sh
#
# What it does:
#   1. Verifies Node.js >= 20 is on PATH.
#   2. Runs `npm install -g @ivenlau/minspect[@version]` (npm bundles all JS;
#      the only native deps are better-sqlite3 + tree-sitter*, which fetch
#      prebuilt binaries during install when possible).
#   3. Suggests `minspect init` so the user can wire up their agent hooks.
#
# Flags:
#   --version X   install @ivenlau/minspect@X instead of latest
#   --skip-init   don't print the `minspect init` hint at the end
#
# This script never edits shell rc files — it relies on whatever global
# install location `npm -g` chose being on the user's PATH, same as `npm
# i -g typescript`. If it isn't, the user gets the same "command not found"
# we can't preempt without platform-specific PATH surgery.

set -eu

VERSION=""
SKIP_INIT=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    --skip-init) SKIP_INIT=1; shift ;;
    -h|--help)
      sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "minspect install: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

die() {
  echo "minspect install: $1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

need node
need npm

# Node >= 20.
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0")
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  die "Node.js 20+ required (found $(node -v))"
fi

PKG="@ivenlau/minspect"
if [ -n "$VERSION" ]; then
  PKG="@ivenlau/minspect@$VERSION"
fi

echo "Installing $PKG via npm..."
npm install -g "$PKG"

echo ""
echo "minspect installed:"
command -v minspect || die "minspect binary not on PATH after install — check npm -g prefix"
minspect --version || true

if [ "$SKIP_INIT" -eq 0 ]; then
  echo ""
  echo "Next step: run \`minspect init\` to detect agents and start the UI."
fi
