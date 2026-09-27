#!/usr/bin/env sh
# Records the fake agent behind egress-tap, then prints the allowlists and the report.
# Needs internet access for the agent's own requests; egress-tap itself only forwards them.
set -eu
cd "$(dirname "$0")"
[ -f ../../dist/cli.js ] || (cd ../.. && npm install && npm run build)
tap() { node ../../dist/cli.js "$@"; }

rm -rf .egress-tap
tap --name demo -- node --no-warnings agent.mjs
echo
echo "=== emit --format claude ==="
tap emit --format claude demo
echo
echo "=== emit --format codex ==="
tap emit --format codex demo 2>/dev/null
echo
echo "=== report ==="
tap report demo
