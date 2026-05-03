#!/usr/bin/env bash
# Switch minspect between local dev and installed npm package.
# Usage:
#   source scripts/dev-switch.sh local   # use local build
#   source scripts/dev-switch.sh npm     # use globally installed package
#   source scripts/dev-switch.sh clear   # uninstall only, don't switch
#   source scripts/dev-switch.sh         # show current mode

set -e

MINSPECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

current_mode() {
  if command -v minspect &>/dev/null; then
    local global_list
    global_list="$(npm list -g --depth=0 2>/dev/null)"
    if [[ "$global_list" == *"<-"* ]]; then
      echo "local (linked)"
    else
      echo "npm (installed)"
    fi
  else
    echo "none"
  fi
}

do_cleanup() {
  if command -v minspect &>/dev/null; then
    echo "Uninstalling current minspect..."
    minspect uninstall --all --yes 2>/dev/null || echo "  (uninstall command failed, continuing)"
    npm uninstall -g @ivenlau/minspect 2>/dev/null || true
    npm uninstall -g @minspect/cli 2>/dev/null || true
    if command -v minspect &>/dev/null; then
      echo "  Warning: minspect command still found at: $(command -v minspect). Manual cleanup may be needed."
    else
      echo "  minspect removed."
    fi
  fi
}

case "${1:-}" in
  local)
    do_cleanup
    echo "Building from source..."
    cd "$MINSPECT_ROOT"
    pnpm -r build
    cd packages/cli && npm link && cd "$MINSPECT_ROOT"
    echo "Linked local build."

    export PATH="$(npm prefix -g)/bin:$PATH"

    if ! command -v minspect &>/dev/null; then
      echo "Error: minspect command not found after install." >&2
      return 1 2>/dev/null || exit 1
    fi
    echo ""
    echo "Running minspect init..."
    minspect init
    ;;
  npm)
    do_cleanup
    echo "Installing from npm..."
    npm install -g @ivenlau/minspect
    echo "Installed @ivenlau/minspect."

    export PATH="$(npm prefix -g)/bin:$PATH"

    if ! command -v minspect &>/dev/null; then
      echo "Error: minspect command not found after install." >&2
      return 1 2>/dev/null || exit 1
    fi
    echo ""
    echo "Running minspect init..."
    minspect init
    ;;
  clear)
    do_cleanup
    echo "Done. minspect uninstalled."
    ;;
  *)
    echo "Current mode: $(current_mode)"
    echo ""
    echo "Usage: source scripts/dev-switch.sh [local|npm|clear]"
    echo "  local  - build from source, link globally"
    echo "  npm    - install from npm registry"
    echo "  clear  - uninstall only, don't switch"
    ;;
esac
