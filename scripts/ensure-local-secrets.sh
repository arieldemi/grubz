#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
secret_file="$project_dir/functions/.secret.local"

mkdir -p "${secret_file:h}"
touch "$secret_file"

if ! grep -q '^NOMA_CREDENTIAL_ENCRYPTION_KEY=' "$secret_file"; then
  generated_key="$(openssl rand -base64 32 | tr -d '\n')"
  printf '\nNOMA_CREDENTIAL_ENCRYPTION_KEY=%s\n' "$generated_key" >> "$secret_file"
  echo "Created the local NOMA credential encryption secret."
fi

encryption_key="$(sed -n 's/^NOMA_CREDENTIAL_ENCRYPTION_KEY=//p' "$secret_file" | tail -1)"
decoded_size="$(printf '%s' "$encryption_key" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' ')"
if [[ "$decoded_size" != "32" ]]; then
  echo "NOMA_CREDENTIAL_ENCRYPTION_KEY in functions/.secret.local must be a base64-encoded 32-byte key." >&2
  exit 1
fi
chmod 600 "$secret_file"

# Prevent the Functions emulator from querying Secret Manager for optional,
# legacy NOMA credentials that are not needed by the Settings-based flow.
if grep -q '^NOMA_INTEGRATION_KEY=$' "$secret_file"; then
  sed -i '' 's/^NOMA_INTEGRATION_KEY=$/NOMA_INTEGRATION_KEY=local-unused/' "$secret_file"
elif ! grep -q '^NOMA_INTEGRATION_KEY=' "$secret_file"; then
  printf 'NOMA_INTEGRATION_KEY=local-unused\n' >> "$secret_file"
fi
if ! grep -q '^NOMA_INTEGRATION_KEYS=' "$secret_file"; then
  printf 'NOMA_INTEGRATION_KEYS={}\n' >> "$secret_file"
fi
