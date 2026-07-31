#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INVENTORY="$REPO_ROOT/ops/device-inventory.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
passed=0

pass() {
  passed=$((passed + 1))
  echo "ok $passed - $1"
}

for command_name in jq ssh-keygen; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "ERROR: missing $command_name" >&2; exit 1; }
done

bash -n \
  "$REPO_ROOT/scripts/device-access.sh" \
  "$REPO_ROOT/scripts/render-device-ssh-config.sh" \
  "$REPO_ROOT/scripts/install-device-client.sh" \
  "$REPO_ROOT/scripts/install-device-relay.sh" \
  "$REPO_ROOT/scripts/prepare-device-keys.sh" \
  "$REPO_ROOT/scripts/authorize-device-key.sh" \
  "$REPO_ROOT/scripts/revoke-device-key.sh" \
  "$REPO_ROOT/scripts/pin-device-host-key.sh" \
  "$REPO_ROOT/deploy/device-access/install-cloud.sh"
pass 'all device-access shell scripts parse'

"$REPO_ROOT/scripts/device-access.sh" check >/dev/null
pass 'production inventory validates'

"$REPO_ROOT/scripts/render-device-ssh-config.sh" > "$TMP/rendered.conf"
cmp -s "$TMP/rendered.conf" "$REPO_ROOT/deploy/device-access/ssh-config"
pass 'committed SSH config matches deterministic renderer output'

jq '
  .updatedAt = "2026-07-31" |
  .devices += [{
    "id": "linux-lab",
    "name": "Linux Lab",
    "role": "test-workstation",
    "hostname": "linux-lab",
    "os": "Ubuntu test fixture",
    "arch": "x86_64",
    "account": "lab",
    "sshAlias": "later-linux-lab",
    "management": {
      "mode": "relay",
      "relayPort": 33103,
      "relayUser": "later-relay-linux-lab",
      "service": "systemd --user later-device-relay.service"
    },
    "observedAddresses": [],
    "access": {},
    "paths": {},
    "constraints": []
  }]
' "$INVENTORY" > "$TMP/inventory-with-new-device.json"

key_dir="$TMP/keys"
mkdir -p "$key_dir"
cp "$REPO_ROOT/ops/device-public-keys/"*.pub "$key_dir/"
ssh-keygen -q -t ed25519 -a 1 -N '' -C 'test-mesh-linux-lab' -f "$TMP/linux-lab-mesh"
ssh-keygen -q -t ed25519 -a 1 -N '' -C 'test-relay-linux-lab' -f "$TMP/linux-lab-relay"
mv "$TMP/linux-lab-mesh.pub" "$key_dir/linux-lab.mesh.pub"
mv "$TMP/linux-lab-relay.pub" "$key_dir/linux-lab.relay.pub"
mesh_fingerprint="$(ssh-keygen -lf "$key_dir/linux-lab.mesh.pub" | awk '{print $2}')"
relay_fingerprint="$(ssh-keygen -lf "$key_dir/linux-lab.relay.pub" | awk '{print $2}')"
jq --arg mesh "$mesh_fingerprint" --arg relay "$relay_fingerprint" '
  (.devices[] | select(.id == "linux-lab") | .access.keyFingerprint) = $mesh |
  (.devices[] | select(.id == "linux-lab") | .management.relayKeyFingerprint) = $relay
' "$TMP/inventory-with-new-device.json" > "$TMP/inventory-with-fingerprints.json"
mv "$TMP/inventory-with-fingerprints.json" "$TMP/inventory-with-new-device.json"

LATER_DEVICE_INVENTORY="$TMP/inventory-with-new-device.json" LATER_DEVICE_PUBLIC_KEY_DIR="$key_dir" "$REPO_ROOT/scripts/device-access.sh" check >/dev/null
LATER_DEVICE_INVENTORY="$TMP/inventory-with-new-device.json" LATER_DEVICE_PUBLIC_KEY_DIR="$key_dir" "$REPO_ROOT/scripts/render-device-ssh-config.sh" > "$TMP/new-device.conf"
grep -q '^Host later-linux-lab$' "$TMP/new-device.conf"
grep -q '^  Port 33103$' "$TMP/new-device.conf"
grep -q '^  HostKeyAlias later-device-linux-lab$' "$TMP/new-device.conf"
pass 'a third relay device is rendered from inventory without code changes'

jq '(.devices[] | select(.id == "linux-lab") | .management.relayPort) = 33102' "$TMP/inventory-with-new-device.json" > "$TMP/duplicate-port.json"
if LATER_DEVICE_INVENTORY="$TMP/duplicate-port.json" LATER_DEVICE_PUBLIC_KEY_DIR="$key_dir" "$REPO_ROOT/scripts/device-access.sh" check >/dev/null 2>&1; then
  echo 'ERROR: duplicate relay port was accepted' >&2
  exit 1
fi
pass 'duplicate relay ports are rejected'

jq '(.devices[] | select(.id == "linux-lab") | .access.keyFingerprint) = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"' "$TMP/inventory-with-new-device.json" > "$TMP/bad-fingerprint.json"
if LATER_DEVICE_INVENTORY="$TMP/bad-fingerprint.json" LATER_DEVICE_PUBLIC_KEY_DIR="$key_dir" "$REPO_ROOT/scripts/device-access.sh" check >/dev/null 2>&1; then
  echo 'ERROR: mismatched public-key fingerprint was accepted' >&2
  exit 1
fi
pass 'archived public-key fingerprint mismatches are rejected'

jq --arg marker '-----BEGIN ' --arg kind 'PRIVATE KEY-----' '.policy.secretStorage = ($marker + $kind)' "$TMP/inventory-with-new-device.json" > "$TMP/secret-pattern.json"
if LATER_DEVICE_INVENTORY="$TMP/secret-pattern.json" LATER_DEVICE_PUBLIC_KEY_DIR="$key_dir" "$REPO_ROOT/scripts/device-access.sh" check >/dev/null 2>&1; then
  echo 'ERROR: obvious private-key material was accepted' >&2
  exit 1
fi
pass 'obvious secret material is rejected from inventory'

test_home="$TMP/test-home"
mkdir -p "$test_home"
HOME="$test_home" "$REPO_ROOT/scripts/authorize-device-key.sh" "$key_dir/linux-lab.mesh.pub" >/dev/null
HOME="$test_home" "$REPO_ROOT/scripts/authorize-device-key.sh" "$key_dir/linux-lab.mesh.pub" >/dev/null
[ "$(wc -l < "$test_home/.ssh/authorized_keys" | tr -d ' ')" = "1" ]
pass 'target-key authorization is idempotent'

HOME="$test_home" "$REPO_ROOT/scripts/revoke-device-key.sh" --plan "$key_dir/linux-lab.mesh.pub" > "$TMP/revoke-plan.txt"
grep -q '^matching_authorized_entries=1$' "$TMP/revoke-plan.txt"
HOME="$test_home" "$REPO_ROOT/scripts/revoke-device-key.sh" "$key_dir/linux-lab.mesh.pub" >/dev/null
[ ! -s "$test_home/.ssh/authorized_keys" ]
find "$test_home/.local/state/later-device-access/backups" -name authorized_keys -type f | grep -q .
pass 'target-key revocation is planned, backed up and applied'

HOME="$test_home" "$REPO_ROOT/scripts/pin-device-host-key.sh" later-device-linux-lab "$key_dir/linux-lab.mesh.pub" >/dev/null
ssh-keygen -F later-device-linux-lab -f "$test_home/.ssh/known_hosts" >/dev/null
pass 'stable host-key aliases are pinned deterministically'

"$REPO_ROOT/deploy/device-access/install-cloud.sh" --plan --inventory "$TMP/inventory-with-new-device.json" --key-dir "$key_dir" > "$TMP/cloud-plan.txt"
grep -q 'devices=4' "$TMP/cloud-plan.txt"
grep -q 'relay_devices=3' "$TMP/cloud-plan.txt"
grep -q 'relay device=linux-lab account=later-relay-linux-lab listen=127.0.0.1:33103' "$TMP/cloud-plan.txt"
pass 'cloud account/permit plan scales from inventory'

if "$REPO_ROOT/deploy/device-access/install-cloud.sh" --plan --inventory "$TMP/inventory-with-new-device.json" --key-dir "$TMP/missing-keys" >/dev/null 2>&1; then
  echo 'ERROR: missing public-key directory was accepted' >&2
  exit 1
fi
pass 'cloud plan fails closed when public keys are missing'

fake_bin="$TMP/fake-bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 2 ]
[ "$1" = "later-pop" ]
exec /bin/sh -c "$2"
FAKE_SSH
chmod 0755 "$fake_bin/ssh"
quoted_output="$(PATH="$fake_bin:$PATH" "$REPO_ROOT/scripts/device-access.sh" run linux-home -- bash -lc 'printf "%s\n" "argument with spaces"')"
[ "$quoted_output" = "argument with spaces" ]
pass 'run preserves remote argument boundaries and nested shell commands'

for markdown_file in \
  "$REPO_ROOT/docs/device-access.zh-CN.md" \
  "$REPO_ROOT/docs/device-onboarding.zh-CN.md"; do
  while IFS= read -r relative_link; do
    link_without_fragment="${relative_link%%#*}"
    [ -e "$(dirname "$markdown_file")/$link_without_fragment" ] || {
      echo "ERROR: broken relative link in $markdown_file: $relative_link" >&2
      exit 1
    }
  done < <(grep -oE '\]\((\.\.?/)[^) ]+' "$markdown_file" | sed -E 's/^\]\(//')
done
pass 'handoff documentation relative links resolve'

echo "1..$passed"
