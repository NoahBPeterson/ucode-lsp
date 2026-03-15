#!/bin/bash
# Check if ucode/ has new commits since the last supported version
# Run from project root: ./scripts/check-ucode-updates.sh

set -e

UCODE_DIR="ucode"
CONFIG_FILE="ucode-upstream.json"

if [ ! -d "$UCODE_DIR/.git" ]; then
  echo "Error: $UCODE_DIR is not a git repo"
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: $CONFIG_FILE not found"
  exit 1
fi

LAST_SUPPORTED=$(grep -o '"lastSupportedCommit": *"[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)

if [ -z "$LAST_SUPPORTED" ]; then
  echo "Error: Could not read lastSupportedCommit from $CONFIG_FILE"
  exit 1
fi

# Fetch latest from upstream
echo "Fetching latest from ucode upstream..."
git -C "$UCODE_DIR" fetch origin 2>/dev/null || git -C "$UCODE_DIR" fetch 2>/dev/null || {
  echo "Warning: Could not fetch from remote, comparing against local HEAD only"
}

# Compare against remote main (fall back to local HEAD if no remote)
REMOTE_REF=$(git -C "$UCODE_DIR" rev-parse --verify origin/master 2>/dev/null || \
             git -C "$UCODE_DIR" rev-parse --verify origin/main 2>/dev/null || \
             git -C "$UCODE_DIR" rev-parse HEAD)
CURRENT_HEAD=$(git -C "$UCODE_DIR" rev-parse --short "$REMOTE_REF")

# Check if there are new commits on remote since last supported
NEW_COMMITS=$(git -C "$UCODE_DIR" log --oneline "${LAST_SUPPORTED}..${REMOTE_REF}" 2>/dev/null)

if [ -z "$NEW_COMMITS" ]; then
  echo "✓ ucode/ is up to date (at $CURRENT_HEAD)"
  exit 0
fi

COUNT=$(echo "$NEW_COMMITS" | wc -l | tr -d ' ')
echo "⚠ ucode/ has $COUNT new commit(s) since last supported ($LAST_SUPPORTED):"
echo ""
echo "$NEW_COMMITS"
echo ""
echo "Review these commits for changes that may need LSP updates:"
echo "  - New module functions or constants"
echo "  - Changed function signatures"
echo "  - New builtin functions"
echo ""
echo "After updating the LSP, update $CONFIG_FILE with the new commit hash."
exit 2
