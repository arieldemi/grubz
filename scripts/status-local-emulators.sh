#!/bin/zsh
set -euo pipefail

service_label="com.grubz.local-emulators"
domain="gui/$(id -u)"

if launchctl print "$domain/$service_label" >/dev/null 2>&1; then
  echo "Service: running under launchd"
else
  echo "Service: stopped or not installed"
fi

for entry in "Hosting:5100" "Functions:5101" "Storage:9199"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  if curl --silent --output /dev/null --max-time 1 "http://127.0.0.1:$port"; then
    echo "$name: ready on http://127.0.0.1:$port"
  else
    echo "$name: not ready on port $port"
  fi
done
