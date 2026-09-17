#!/usr/bin/env pwsh
#
# Reports which of the two tools the ladder needs are installed, and prints the
# install command for whichever is missing.
#
#   ./scripts/preflight.ps1
#
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir 'lean-fetch.mjs') --check
exit $LASTEXITCODE
