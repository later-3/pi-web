#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INVENTORY="${LATER_DEVICE_INVENTORY:-$REPO_ROOT/ops/device-inventory.json}"
KEY_DIR="${LATER_DEVICE_PUBLIC_KEY_DIR:-$REPO_ROOT/ops/device-public-keys}"
PLAN_ONLY=0

usage() {
  cat <<'EOF' >&2
Usage: ./deploy/device-access/install-cloud.sh [--plan] [--inventory FILE] [--key-dir DIR]

Public-key directory naming:
  <device-id>.mesh.pub    required for every inventory device
  <device-id>.relay.pub   required for every management.mode=relay device

--plan validates the complete inventory/key set and prints the intended cloud
accounts and loopback listeners without requiring root or changing the system.
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan)
      PLAN_ONLY=1
      shift
      ;;
    --inventory)
      [ "$#" -ge 2 ] || usage
      INVENTORY="$2"
      shift 2
      ;;
    --key-dir)
      [ "$#" -ge 2 ] || usage
      KEY_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

[ -r "$INVENTORY" ] || { echo "ERROR: inventory is not readable: $INVENTORY" >&2; exit 1; }
[ -d "$KEY_DIR" ] || { echo "ERROR: public-key directory does not exist: $KEY_DIR" >&2; exit 1; }
LATER_DEVICE_INVENTORY="$INVENTORY" LATER_DEVICE_PUBLIC_KEY_DIR="$KEY_DIR" "$REPO_ROOT/scripts/device-access.sh" check >/dev/null

validate_key() {
  local key="$1"
  [ -r "$key" ] || { echo "ERROR: missing public key: $key" >&2; exit 1; }
  ssh-keygen -lf "$key" >/dev/null || { echo "ERROR: invalid SSH public key: $key" >&2; exit 1; }
}

for device_id in $(jq -r '.devices[].id' "$INVENTORY"); do
  validate_key "$KEY_DIR/$device_id.mesh.pub"
done
for device_id in $(jq -r '.devices[] | select(.management.mode == "relay") | .id' "$INVENTORY"); do
  validate_key "$KEY_DIR/$device_id.relay.pub"
done

FORWARD_USER="$(jq -r '.bastion.forwardUser' "$INVENTORY")"
LOOPBACK="$(jq -r '.bastion.loopbackAddress' "$INVENTORY")"
BASTION_DEVICE_ID="$(jq -r '.bastion.deviceId' "$INVENTORY")"
BASTION_ACCOUNT="$(jq -r --arg id "$BASTION_DEVICE_ID" '.devices[] | select(.id == $id) | .account' "$INVENTORY")"

echo "inventory=$INVENTORY"
echo "devices=$(jq '.devices | length' "$INVENTORY")"
echo "relay_devices=$(jq '[.devices[] | select(.management.mode == "relay")] | length' "$INVENTORY")"
echo "forward_account=$FORWARD_USER"
echo "bastion_target_account=$BASTION_ACCOUNT"
jq -r --arg loopback "$LOOPBACK" '
  .devices[] | select(.management.mode == "relay") |
  "relay device=" + .id + " account=" + .management.relayUser + " listen=" + $loopback + ":" + (.management.relayPort | tostring)
' "$INVENTORY"

if [ "$PLAN_ONLY" -eq 1 ]; then
  echo 'mode=plan-only'
  exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo "ERROR: installation must run as root" >&2; exit 1; }

ensure_restricted_user() {
  local user="$1"
  local expected_home="/var/lib/$user"
  local actual_home
  if ! id "$user" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$expected_home" --shell /usr/sbin/nologin "$user"
  fi
  actual_home="$(getent passwd "$user" | cut -d: -f6)"
  [ "$actual_home" = "$expected_home" ] || {
    echo "ERROR: existing account $user has unexpected home $actual_home" >&2
    exit 1
  }
  install -d -o "$user" -g "$user" -m 0700 "$actual_home/.ssh"
}

install_authorized_keys() {
  local user="$1"
  local source="$2"
  local home
  home="$(getent passwd "$user" | cut -d: -f6)"
  install -o "$user" -g "$user" -m 0600 "$source" "$home/.ssh/authorized_keys"
}

BACKUP_DIR="/var/backups/later-device-access/$(date -u +%Y%m%dT%H%M%SZ)"
backup_authorized_keys() {
  local user="$1"
  local home
  home="$(getent passwd "$user" | cut -d: -f6)"
  [ -f "$home/.ssh/authorized_keys" ] || return 0
  install -d -m 0700 "$BACKUP_DIR/$user"
  cp -p "$home/.ssh/authorized_keys" "$BACKUP_DIR/$user/authorized_keys"
}

replace_managed_target_keys() {
  local account="$1"
  local source="$2"
  local home group authorized cleaned blobs final
  home="$(getent passwd "$account" | cut -d: -f6)"
  group="$(id -gn "$account")"
  [ -n "$home" ] || { echo "ERROR: cannot resolve home for $account" >&2; exit 1; }
  install -d -o "$account" -g "$group" -m 0700 "$home/.ssh"
  authorized="$home/.ssh/authorized_keys"
  touch "$authorized"
  chown "$account:$group" "$authorized"
  chmod 0600 "$authorized"
  cleaned="$TMPDIR/target-cleaned"
  blobs="$TMPDIR/managed-blobs"
  final="$TMPDIR/target-final"
  awk '{print $2}' "$source" > "$blobs"
  awk -v begin='# BEGIN later-device-access managed keys' -v end='# END later-device-access managed keys' '
    NR == FNR { managed[$1] = 1; next }
    $0 == begin { in_block = 1; next }
    $0 == end { in_block = 0; next }
    in_block { next }
    {
      drop = 0
      for (i = 1; i <= NF; i++) if ($i in managed) drop = 1
      if (!drop) print
    }
  ' "$blobs" "$authorized" > "$cleaned"
  {
    cat "$cleaned"
    echo '# BEGIN later-device-access managed keys'
    cat "$source"
    echo '# END later-device-access managed keys'
  } > "$final"
  install -o "$account" -g "$group" -m 0600 "$final" "$authorized"
}

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT HUP INT TERM

mesh_options='restrict'
relay_count="$(jq '[.devices[] | select(.management.mode == "relay")] | length' "$INVENTORY")"
if [ "$relay_count" -gt 0 ]; then
  mesh_options="$mesh_options,port-forwarding"
fi
for relay_port in $(jq -r '.devices[] | select(.management.mode == "relay") | .management.relayPort' "$INVENTORY"); do
  mesh_options="$mesh_options,permitopen=\"$LOOPBACK:$relay_port\""
done

mesh_authorized="$TMPDIR/mesh-authorized_keys"
target_authorized="$TMPDIR/target-authorized_keys"
: > "$mesh_authorized"
: > "$target_authorized"
for device_id in $(jq -r '.devices[].id' "$INVENTORY"); do
  printf '%s ' "$mesh_options" >> "$mesh_authorized"
  cat "$KEY_DIR/$device_id.mesh.pub" >> "$mesh_authorized"
  cat "$KEY_DIR/$device_id.mesh.pub" >> "$target_authorized"
done

ensure_restricted_user "$FORWARD_USER"
backup_authorized_keys "$FORWARD_USER"
install_authorized_keys "$FORWARD_USER" "$mesh_authorized"

while IFS=$'\t' read -r device_id relay_user relay_port; do
  ensure_restricted_user "$relay_user"
  backup_authorized_keys "$relay_user"
  relay_authorized="$TMPDIR/$device_id-relay-authorized_keys"
  printf 'restrict,port-forwarding,permitlisten="%s:%s" ' "$LOOPBACK" "$relay_port" > "$relay_authorized"
  cat "$KEY_DIR/$device_id.relay.pub" >> "$relay_authorized"
  install_authorized_keys "$relay_user" "$relay_authorized"
done < <(jq -r '.devices[] | select(.management.mode == "relay") | [.id, .management.relayUser, .management.relayPort] | @tsv' "$INVENTORY")

backup_authorized_keys "$BASTION_ACCOUNT"
replace_managed_target_keys "$BASTION_ACCOUNT" "$target_authorized"
sshd -t

echo "Installed restricted forward account: $FORWARD_USER"
echo "Installed relay accounts: $(jq -r '[.devices[] | select(.management.mode == "relay") | .management.relayUser] | join(", ")' "$INVENTORY")"
echo "Managed target keys for bastion account: $BASTION_ACCOUNT"
if [ -d "$BACKUP_DIR" ]; then
  echo "Backups: $BACKUP_DIR"
fi
