#!/usr/bin/env bash
# goalpost uninstaller for macOS and Linux: ./uninstall.sh
# Your projects keep their .goal/ folders - delete them by hand if you want.
set -uo pipefail
command -v claude >/dev/null 2>&1 || { echo "[x] Claude Code is not on PATH, nothing to uninstall from."; exit 0; }

echo "[1/3] Removing the plugin..."
claude plugin uninstall goalpost@goalpost --scope user
for s in project local; do claude plugin uninstall goalpost@goalpost --scope "$s" >/dev/null 2>&1; done

echo "[2/3] Removing the goalpost marketplace..."
claude plugin marketplace remove goalpost

echo "[3/3] Removing settings..."
rm -f "$HOME/.claude/goalpost.json" && echo "    removed ~/.claude/goalpost.json (if it existed)"
rm -rf "${TMPDIR:-/tmp}/goalpost"

if claude plugin list | grep -qi goalpost; then
  echo; echo " [!] goalpost is still listed - run 'claude plugin list' to see where it is installed."
else
  echo; echo " goalpost is removed. /goal works exactly as before."
fi
echo " Folders named .goal inside your projects were left alone."
