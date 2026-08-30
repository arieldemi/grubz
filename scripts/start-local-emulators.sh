#!/bin/zsh
set -euo pipefail

service_label="com.grubz.local-emulators"
domain="gui/$(id -u)"
installed_plist="$HOME/Library/LaunchAgents/$service_label.plist"

if ! launchctl print "$domain/$service_label" >/dev/null 2>&1; then
  if [[ ! -f "$installed_plist" ]]; then
    echo "Service is not installed. Run: npm run local:install" >&2
    exit 1
  fi
  launchctl bootstrap "$domain" "$installed_plist"
fi
launchctl enable "$domain/$service_label"
launchctl kickstart -k "$domain/$service_label"
echo "GRUBZ local emulators started."
