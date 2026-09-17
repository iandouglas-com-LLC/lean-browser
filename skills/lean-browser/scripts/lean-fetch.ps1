#!/usr/bin/env pwsh
#
# lean-fetch: Windows entry point.
#
# The ladder itself lives in lean-fetch.mjs, so the behaviour on macOS, Linux,
# and Windows cannot drift apart. This script only checks for Node and hands
# over.
#
#   ./scripts/lean-fetch.ps1 https://example.com
#   ./scripts/lean-fetch.ps1 wiki article "Eiffel Tower" --budget 2000
#   ./scripts/lean-fetch.ps1 --check
#
# If PowerShell mangles an argument that starts with --, call the shared entry
# point directly, which sidesteps the shell entirely:
#
#   node scripts/lean-fetch.mjs --check
#
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$entry = Join-Path $scriptDir 'lean-fetch.mjs'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'lean-fetch: node is not on your PATH. oc needs Node 20 or newer.'
    exit 1
}

if (-not (Test-Path $entry)) {
    Write-Error "lean-fetch: cannot find $entry"
    exit 1
}

& node $entry @args
exit $LASTEXITCODE
