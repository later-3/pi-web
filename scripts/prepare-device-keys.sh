#!/usr/bin/env bash

set -euo pipefail

[ "$#" -eq 2 ] || { echo "Usage: $0 <device-id> <relay|direct>" >&2; exit 2; }
DEVICE_ID="$1"
MODE="$2"

case "$DEVICE_ID" in
  ''|*[!a-z0-9-]*|-*|*-) echo "ERROR: device id must be a lowercase slug" >&2; exit 1;;
esac
case "$MODE" in relay|direct) ;; *) echo "ERROR: mode must be relay or direct" >&2; exit 1;; esac

umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

mesh_key="$HOME/.ssh/id_ed25519_later_mesh"
relay_key="$HOME/.ssh/id_ed25519_later_relay"

if [ ! -f "$mesh_key" ]; then
  ssh-keygen -q -t ed25519 -a 64 -N '' -C "later-mesh-$DEVICE_ID" -f "$mesh_key"
fi
echo "mesh_fingerprint=$(ssh-keygen -lf "$mesh_key.pub" | awk '{print $2}')"
echo "archive_mesh_as=ops/device-public-keys/$DEVICE_ID.mesh.pub"

if [ "$MODE" = "relay" ]; then
  if [ ! -f "$relay_key" ]; then
    ssh-keygen -q -t ed25519 -a 64 -N '' -C "later-relay-$DEVICE_ID" -f "$relay_key"
  fi
  echo "relay_fingerprint=$(ssh-keygen -lf "$relay_key.pub" | awk '{print $2}')"
  echo "archive_relay_as=ops/device-public-keys/$DEVICE_ID.relay.pub"
fi

echo 'Private keys remain local; copy only the .pub files to the archive paths.'
