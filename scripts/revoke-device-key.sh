#!/usr/bin/env bash

set -euo pipefail

PLAN_ONLY=0
if [ "${1:-}" = "--plan" ]; then
  PLAN_ONLY=1
  shift
fi
[ "$#" -ge 1 ] || { echo "Usage: $0 [--plan] <public-key-file> [...]" >&2; exit 2; }

authorized="$HOME/.ssh/authorized_keys"
[ -f "$authorized" ] || { echo "ERROR: authorized_keys does not exist: $authorized" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
blobs="$TMP/blobs"
: > "$blobs"

for public_key_file in "$@"; do
  [ -r "$public_key_file" ] || { echo "ERROR: unreadable public key: $public_key_file" >&2; exit 1; }
  ssh-keygen -lf "$public_key_file" >/dev/null
  awk 'NR == 1 {print $2}' "$public_key_file" >> "$blobs"
  echo "candidate: $(ssh-keygen -lf "$public_key_file")"
done

matches="$(awk '
  NR == FNR { revoked[$1] = 1; next }
  {
    for (i = 1; i <= NF; i++) if ($i in revoked) count++
  }
  END { print count + 0 }
' "$blobs" "$authorized")"
echo "matching_authorized_entries=$matches"

if [ "$PLAN_ONLY" -eq 1 ]; then
  echo 'mode=plan-only'
  exit 0
fi
[ "$matches" -gt 0 ] || { echo 'No matching keys; no change made'; exit 0; }

filtered="$TMP/authorized_keys"
awk '
  NR == FNR { revoked[$1] = 1; next }
  {
    drop = 0
    for (i = 1; i <= NF; i++) if ($i in revoked) drop = 1
    if (!drop) print
  }
' "$blobs" "$authorized" > "$filtered"

backup_dir="$HOME/.local/state/later-device-access/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
cp -p "$authorized" "$backup_dir/authorized_keys"
install -m 0600 "$filtered" "$authorized"
echo "Revoked $matches authorized key entry/entries"
echo "Backup: $backup_dir/authorized_keys"
