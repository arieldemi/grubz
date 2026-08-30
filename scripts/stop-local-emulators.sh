#!/bin/zsh
set -euo pipefail

service_label="com.grubz.local-emulators"
domain="gui/$(id -u)"

launchctl bootout "$domain/$service_label" 2>/dev/null || true
echo "GRUBZ local emulators stopped. Run npm run local:start to start them again."
