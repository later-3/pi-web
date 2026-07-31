#!/usr/bin/env bash

set -euo pipefail

[ "$#" -eq 2 ] || { echo "Usage: $0 <host-key-alias> <host-public-key-file>" >&2; exit 2; }

alias_name="$1"
public_key_file="$2"

case "$alias_name" in
  later-device-*) ;;
  *) echo "ERROR: host-key alias must start with later-device-" >&2; exit 1;;
esac

[ -r "$public_key_file" ] || { echo "ERROR: unreadable host public key: $public_key_file" >&2; exit 1; }
ssh-keygen -lf "$public_key_file" >/dev/null

key_type="$(awk 'NR == 1 {print $1}' "$public_key_file")"
key_blob="$(awk 'NR == 1 {print $2}' "$public_key_file")"

umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
known_hosts="$HOME/.ssh/known_hosts"
touch "$known_hosts"
chmod 600 "$known_hosts"

ssh-keygen -R "$alias_name" -f "$known_hosts" >/dev/null 2>&1 || true
printf '%s %s %s\n' "$alias_name" "$key_type" "$key_blob" >> "$known_hosts"

echo "Pinned $alias_name: $(ssh-keygen -lf "$public_key_file")"
