#!/usr/bin/env bash
# goalpost installer for macOS and Linux: ./install.sh
# Run from a cloned repo it installs that copy; on its own it installs from GitHub.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo
echo " goalpost: makes Claude Code's /goal finish the job"
echo

command -v claude >/dev/null 2>&1 || { echo "[x] Claude Code is not installed or not on PATH: https://code.claude.com/docs/en/setup"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[x] Node.js 18+ is required for goalpost's hooks: https://nodejs.org"; exit 1; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 18 ] || { echo "[x] Node.js $major is too old, goalpost needs 18 or newer."; exit 1; }

if [ -f "$here/.claude-plugin/marketplace.json" ]; then
  source="$here"; echo "[1/3] Using the local copy in $here"
else
  source="syntaxixr/goalpost"; echo "[1/3] Using GitHub: syntaxixr/goalpost"
fi
claude plugin marketplace add "$source" || claude plugin marketplace update goalpost

echo "[2/3] Installing the plugin for your user (all projects)..."
claude plugin install goalpost@goalpost --scope user
claude plugin update goalpost@goalpost >/dev/null 2>&1 || true

echo "[3/3] Checking..."
claude plugin list | grep -i goalpost

cat <<'EOF'

 Done. Start a NEW Claude Code session and use /goal as usual:
     /goal build what TASK.md describes, everything must work
 Status: /goalpost:status    Off/on: /goalpost:off, /goalpost:on
 Remove: ./uninstall.sh
EOF
