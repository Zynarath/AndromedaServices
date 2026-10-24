#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --omit=dev
export ANDROMEDA_LAUNCHER=1
while true; do
  node src/index.js
  code=$?
  [ "$code" = 75 ] || exit "$code"
  echo "Restarting Andromeda Hosting after an update..."
done
