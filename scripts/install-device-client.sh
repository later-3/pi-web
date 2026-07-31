#!/usr/bin/env bash

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  SOURCE_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in
    /*) ;;
    *) SOURCE="$SOURCE_DIR/$SOURCE" ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INVENTORY="${LATER_DEVICE_INVENTORY:-$REPO_ROOT/ops/device-inventory.json}"
DEVICE_ID="${LATER_DEVICE_ID:-}"
PLAN_ONLY=0

usage() {
  cat <<'EOF' >&2
Usage: ./scripts/install-device-client.sh <device-id> [--plan]

Installs the inventory-derived SSH client configuration and management key for
one source device. It does not install a reverse relay service; relay-managed
targets should use install-device-relay.sh, which calls this script first.
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan) PLAN_ONLY=1; shift ;;
    -h|--help) usage ;;
    -*) usage ;;
    *) [ -z "$DEVICE_ID" ] || usage; DEVICE_ID="$1"; shift ;;
  esac
done

[ -n "$DEVICE_ID" ] || usage
[ -r "$INVENTORY" ] || { echo "ERROR: inventory is not readable: $INVENTORY" >&2; exit 1; }
LATER_DEVICE_INVENTORY="$INVENTORY" "$REPO_ROOT/scripts/device-access.sh" check >/dev/null

record="$(jq -c --arg id "$DEVICE_ID" '[.devices[] | select(.id == $id)] | first // empty' "$INVENTORY")"
[ -n "$record" ] || { echo "ERROR: unknown device id: $DEVICE_ID" >&2; exit 1; }
EXPECTED_ACCOUNT="$(printf '%s' "$record" | jq -r '.account')"
EXPECTED_HOSTNAME="$(printf '%s' "$record" | jq -r '.hostname')"
CLOUD_HOST="$(jq -r '.bastion.host' "$INVENTORY")"

echo "device_id=$DEVICE_ID"
echo "expected_account=$EXPECTED_ACCOUNT"
echo "expected_hostname=$EXPECTED_HOSTNAME"
echo "inventory=$INVENTORY"
echo "ssh_config=$HOME/.ssh/config.d/later-devices.conf"
if [ "$PLAN_ONLY" -eq 1 ]; then
  echo 'mode=plan-only'
  exit 0
fi

[ "$(id -un)" = "$EXPECTED_ACCOUNT" ] || {
  echo "ERROR: inventory account $EXPECTED_ACCOUNT does not match current account $(id -un)" >&2
  exit 1
}
current_hostname="$(hostname -s 2>/dev/null || hostname)"
if [ "$current_hostname" != "$EXPECTED_HOSTNAME" ]; then
  echo "WARNING: inventory hostname $EXPECTED_HOSTNAME differs from current hostname $current_hostname" >&2
fi

umask 077
mkdir -p "$HOME/.ssh/config.d" "$HOME/.local/bin" "$HOME/.local/state/later-device-access/backups"
chmod 700 "$HOME/.ssh" "$HOME/.ssh/config.d"

if [ ! -f "$HOME/.ssh/id_ed25519_later_mesh" ]; then
  ssh-keygen -q -t ed25519 -a 64 -N '' -C "later-mesh-$DEVICE_ID" -f "$HOME/.ssh/id_ed25519_later_mesh"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$HOME/.local/state/later-device-access/backups/$timestamp"
backup_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  mkdir -p "$backup_dir"
  cp -p "$file" "$backup_dir/$(basename "$file")"
}

ssh_config_target="$HOME/.ssh/config.d/later-devices.conf"
backup_file "$ssh_config_target"
rendered_config="$(mktemp)"
trap 'rm -f "$rendered_config"' EXIT HUP INT TERM
LATER_DEVICE_INVENTORY="$INVENTORY" "$REPO_ROOT/scripts/render-device-ssh-config.sh" > "$rendered_config"
install -m 0600 "$rendered_config" "$ssh_config_target"

if [ ! -f "$HOME/.ssh/config" ]; then
  touch "$HOME/.ssh/config"
  chmod 600 "$HOME/.ssh/config"
fi
if ! grep -Eq '^[[:space:]]*Include[[:space:]]+~/.ssh/config\.d/\*' "$HOME/.ssh/config"; then
  backup_file "$HOME/.ssh/config"
  tmp_config="$(mktemp)"
  {
    echo 'Include ~/.ssh/config.d/*'
    cat "$HOME/.ssh/config"
  } > "$tmp_config"
  install -m 0600 "$tmp_config" "$HOME/.ssh/config"
  rm -f "$tmp_config"
fi

if ! ssh-keygen -F "$CLOUD_HOST" >/dev/null 2>&1; then
  echo "ERROR: $CLOUD_HOST is not in ~/.ssh/known_hosts; verify and pin its host key first" >&2
  exit 1
fi

ln -sfn "$REPO_ROOT/scripts/device-access.sh" "$HOME/.local/bin/later-device"
trap - EXIT HUP INT TERM
rm -f "$rendered_config"

echo "Installed inventory-derived SSH client configuration"
echo "Mesh key: $(ssh-keygen -lf "$HOME/.ssh/id_ed25519_later_mesh.pub")"
echo "Command: $HOME/.local/bin/later-device"
