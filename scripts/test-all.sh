#!/bin/sh
set -eu

# --e2e also runs real VS Code in an isolated profile. Requires the code CLI.
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--e2e" ]; }; then
    echo "Usage: $0 [--e2e]" >&2
    exit 2
fi

if [ -z "${STUDIO_HEAVY_SLOT:-}" ] && command -v heavy >/dev/null 2>&1; then
    exec heavy run --label "memopad checks" -- "$0" "$@"
fi

cd "$(dirname "$0")/.."
npm run lint
npm test
if [ "${1:-}" = "--e2e" ]; then
    npm run test:host
fi
