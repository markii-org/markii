#!/bin/sh
# Runs the headless plugin test against the built CLI in this repository.
# Build it first: `npm run build -w @markii/cli`. Set MARKII_CMD to test
# another install, e.g. MARKII_CMD=markii.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
if [ -z "${MARKII_CMD:-}" ]; then
  MARKII_CMD="node $root/apps/cli/dist/markii.mjs"
fi
export MARKII_CMD
exec nvim --headless -u NONE -i NONE --cmd "set rtp+=$here/.." -l "$here/headless.lua"
