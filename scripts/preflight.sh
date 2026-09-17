#!/usr/bin/env bash
#
# Reports which of the two tools the ladder needs are installed, and prints the
# install command for whichever is missing.
#
#   ./scripts/preflight.sh
#
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/lean-fetch.mjs" --check
