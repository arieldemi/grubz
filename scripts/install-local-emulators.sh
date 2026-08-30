#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
service_label="com.grubz.local-emulators"
launch_agents_dir="$HOME/Library/LaunchAgents"
installed_plist="$launch_agents_dir/$service_label.plist"
template="$project_dir/scripts/$service_label.plist.template"
domain="gui/$(id -u)"

mkdir -p "$launch_agents_dir" "$project_dir/.local-emulators/logs"
sed "s|__PROJECT_DIR__|$project_dir|g" "$template" > "$installed_plist"
plutil -lint "$installed_plist"
launchctl bootout "$domain/$service_label" 2>/dev/null || true
launchctl bootstrap "$domain" "$installed_plist"
launchctl enable "$domain/$service_label"
launchctl kickstart -k "$domain/$service_label"

echo "GRUBZ local emulators installed and started."
echo "Hosting:   http://127.0.0.1:5100"
echo "Functions: http://127.0.0.1:5101"
echo "Storage:   http://127.0.0.1:9199"
echo "Logs:      $project_dir/.local-emulators/logs/"
