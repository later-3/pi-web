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
Usage: ./scripts/install-device-relay.sh <device-id> [--plan]

Installs the inventory-derived SSH client configuration, per-device relay key
and persistent reverse relay service. Relay account, port and bastion address
come only from ops/device-inventory.json.
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
[ "$(printf '%s' "$record" | jq -r '.management.mode')" = "relay" ] || { echo "ERROR: $DEVICE_ID is not a relay-managed device" >&2; exit 1; }

SSH_ALIAS="$(printf '%s' "$record" | jq -r '.sshAlias')"
RELAY_USER="$(printf '%s' "$record" | jq -r '.management.relayUser')"
RELAY_PORT="$(printf '%s' "$record" | jq -r '.management.relayPort')"
CLOUD_HOST="$(jq -r '.bastion.host' "$INVENTORY")"
HOST_KEY_ALIAS="$(jq -r '.defaults.hostKeyAliasPrefix' "$INVENTORY")$DEVICE_ID"

echo "device_id=$DEVICE_ID"
echo "ssh_alias=$SSH_ALIAS"
echo "relay_account=$RELAY_USER"
echo "relay_endpoint=$CLOUD_HOST"
echo "cloud_loopback_port=$RELAY_PORT"

if [ "$PLAN_ONLY" -eq 1 ]; then
  LATER_DEVICE_INVENTORY="$INVENTORY" "$REPO_ROOT/scripts/install-device-client.sh" "$DEVICE_ID" --plan
  echo 'relay_mode=plan-only'
  exit 0
fi

LATER_DEVICE_INVENTORY="$INVENTORY" "$REPO_ROOT/scripts/install-device-client.sh" "$DEVICE_ID"

umask 077
if [ ! -f "$HOME/.ssh/id_ed25519_later_relay" ]; then
  ssh-keygen -q -t ed25519 -a 64 -N '' -C "later-relay-$DEVICE_ID" -f "$HOME/.ssh/id_ed25519_later_relay"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$HOME/.local/state/later-device-access/backups/$timestamp"
backup_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  mkdir -p "$backup_dir"
  cp -p "$file" "$backup_dir/$(basename "$file")"
}

case "$(uname -s)" in
  Darwin)
    template="$REPO_ROOT/deploy/device-access/macos/com.later.device-relay.plist.in"
    target="$HOME/Library/LaunchAgents/com.later.device-relay.plist"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    backup_file "$target"
    sed -e "s#__HOME__#$HOME#g" -e "s#__CLOUD_HOST__#$CLOUD_HOST#g" -e "s#__RELAY_USER__#$RELAY_USER#g" -e "s#__RELAY_PORT__#$RELAY_PORT#g" "$template" > "$target.tmp"
    plutil -lint "$target.tmp" >/dev/null
    mv "$target.tmp" "$target"
    chmod 600 "$target"
    launchctl bootout "gui/$(id -u)/com.later.device-relay" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$target"
    ;;
  Linux)
    template="$REPO_ROOT/deploy/device-access/linux/later-device-relay.service.in"
    target="$HOME/.config/systemd/user/later-device-relay.service"
    mkdir -p "$HOME/.config/systemd/user"
    backup_file "$target"
    sed -e "s#__CLOUD_HOST__#$CLOUD_HOST#g" -e "s#__RELAY_USER__#$RELAY_USER#g" -e "s#__RELAY_PORT__#$RELAY_PORT#g" "$template" > "$target.tmp"
    mv "$target.tmp" "$target"
    chmod 600 "$target"
    systemctl --user daemon-reload
    systemctl --user enable --now later-device-relay.service
    if command -v loginctl >/dev/null 2>&1 && [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" != "yes" ]; then
      echo 'WARNING: Linger is not enabled; the user relay may stop when the login session ends' >&2
    fi
    ;;
  *)
    echo "ERROR: unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

echo "Installed device relay: $RELAY_USER@$CLOUD_HOST -> cloud loopback port $RELAY_PORT"
echo "Relay key: $(ssh-keygen -lf "$HOME/.ssh/id_ed25519_later_relay.pub")"
if ssh-keygen -F "$HOST_KEY_ALIAS" >/dev/null 2>&1; then
  ssh -n -o BatchMode=yes -o ConnectTimeout=8 "$SSH_ALIAS" true
  echo "End-to-end self-check: $SSH_ALIAS ok"
else
  echo "NEXT: pin the target host key as $HOST_KEY_ALIAS, then run: later-device probe $DEVICE_ID"
fi
