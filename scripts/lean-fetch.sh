#!/usr/bin/env bash
#
# lean-fetch: macOS and Linux entry point, and Git Bash on Windows.
#
# The ladder itself lives in lean-fetch.mjs, so the behaviour on macOS, Linux,
# and Windows cannot drift apart. This script only checks for Node and hands
# over.
#
#   ./scripts/lean-fetch.sh https://example.com
#   ./scripts/lean-fetch.sh wiki article Eiffel Tower --budget 300
#   ./scripts/lean-fetch.sh --check
#
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
entry="$script_dir/lean-fetch.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "lean-fetch: node is not on your PATH." >&2
  echo "oc needs Node 20 or newer: https://nodejs.org" >&2
  exit 1
fi

if [ ! -f "$entry" ]; then
  echo "lean-fetch: cannot find $entry" >&2
  exit 1
fi

exec node "$entry" "$@"
