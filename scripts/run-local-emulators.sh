#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
zsh "$project_dir/scripts/ensure-local-secrets.sh"
cd "$project_dir"
exec firebase emulators:start --only hosting,functions,storage --project grubz-99b84
