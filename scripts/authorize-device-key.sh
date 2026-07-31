#!/usr/bin/env bash

set -euo pipefail

[ "$#" -ge 1 ] || { echo "Usage: $0 <public-key-file> [...]" >&2; exit 2; }

umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
authorized="$HOME/.ssh/authorized_keys"
touch "$authorized"
chmod 600 "$authorized"

for public_key_file in "$@"; do
  [ -r "$public_key_file" ] || { echo "ERROR: unreadable public key: $public_key_file" >&2; exit 1; }
  ssh-keygen -lf "$public_key_file" >/dev/null
  key_type="$(awk 'NR == 1 {print $1}' "$public_key_file")"
  key_blob="$(awk 'NR == 1 {print $2}' "$public_key_file")"
  if awk -v key_type="$key_type" -v key_blob="$key_blob" '
    {
      for (i = 1; i < NF; i++) {
        if ($i == key_type && $(i + 1) == key_blob) found = 1
      }
    }
    END { exit found ? 0 : 1 }
  ' "$authorized"; then
    echo "Already authorized: $(ssh-keygen -lf "$public_key_file")"
    continue
  fi
  printf '%s\n' "$(head -n 1 "$public_key_file")" >> "$authorized"
  echo "Authorized: $(ssh-keygen -lf "$public_key_file")"
done
