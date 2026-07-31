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
PUBLIC_KEY_DIR="${LATER_DEVICE_PUBLIC_KEY_DIR:-$REPO_ROOT/ops/device-public-keys}"
CONNECT_TIMEOUT="${LATER_DEVICE_CONNECT_TIMEOUT:-}"
if [ -z "$CONNECT_TIMEOUT" ] && [ -r "$INVENTORY" ] && command -v jq >/dev/null 2>&1; then
  CONNECT_TIMEOUT="$(jq -r '.defaults.connectTimeoutSeconds // empty' "$INVENTORY" 2>/dev/null || true)"
fi
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-8}"

usage() {
  cat <<'EOF'
Usage: ./scripts/device-access.sh <command> [device] [-- command...]

Commands:
  list                    List archived devices, routes and SSH aliases
  show <device>           Show one archived device record
  credentials [device]    Show credential status/reference metadata only
  topology                Show the derived management topology
  route <device>          Show the effective SSH route (no secrets)
  probe [device|all]      Test SSH connectivity through the configured route
  verify-write [device|all] Create, verify and remove a private temp file
  facts <device|all>      Query live OS, network and service facts
  audit [device|all]      Read-only inventory, route, probe and facts audit
  run <device> -- <cmd>   Run a command on a device
  ssh <device>            Open an interactive SSH session
  check                   Validate inventory schema and secret boundary

Device may be an inventory id (mac-main) or its SSH alias (later-mac).
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

quote_remote_arg() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

build_remote_command() {
  local command=""
  local quoted argument
  for argument in "$@"; do
    quoted="$(quote_remote_arg "$argument")"
    if [ -n "$command" ]; then
      command="$command $quoted"
    else
      command="$quoted"
    fi
  done
  printf '%s\n' "$command"
}

check_inventory_file() {
  [ -r "$INVENTORY" ] || die "inventory is not readable: $INVENTORY"
  require_command jq
  jq -e '
    .schemaVersion == 2 and
    (.updatedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) and
    (.defaults.identityFile | type == "string" and test("^[A-Za-z0-9~_./-]+$")) and
    (.defaults.connectTimeoutSeconds | type == "number" and . >= 1 and . <= 60) and
    (.defaults.hostKeyAliasPrefix | type == "string" and test("^[A-Za-z0-9._-]+$")) and
    (.bastion.deviceId | type == "string" and test("^[a-z0-9][a-z0-9-]{0,62}$")) and
    (.bastion.sshAlias | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")) and
    (.bastion.host | type == "string" and test("^[A-Za-z0-9:._-]+$")) and
    (.bastion.port | type == "number" and . >= 1 and . <= 65535) and
    (.bastion.forwardUser | type == "string" and test("^[A-Za-z_][A-Za-z0-9._-]{0,63}$")) and
    .bastion.loopbackAddress == "127.0.0.1" and
    (.devices | type == "array" and length > 0 and length <= 64) and
    (all(.devices[];
      (.id | type == "string" and test("^[a-z0-9][a-z0-9-]{0,62}$")) and
      (.name | type == "string" and length > 0) and
      (.account | type == "string" and test("^[A-Za-z_][A-Za-z0-9._-]{0,63}$")) and
      (.sshAlias | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")) and
      (.management.mode == "relay" or .management.mode == "direct") and
      (if .management.mode == "relay" then
        (.management.relayPort | type == "number" and . >= 1024 and . <= 65535) and
        (.management.relayUser | type == "string" and test("^[A-Za-z_][A-Za-z0-9._-]{0,63}$")) and
        (.management.relayKeyFingerprint | type == "string" and test("^SHA256:[A-Za-z0-9+/]+$")) and
        (.management.service | type == "string" and length > 0)
      else
        (.management.host | type == "string" and test("^[A-Za-z0-9:._-]+$")) and
        (.management.port | type == "number" and . >= 1 and . <= 65535)
      end)))
  ' "$INVENTORY" >/dev/null || die "inventory schema validation failed"

  jq -e '
    ([.devices[].id] | length == (unique | length)) and
    ([.devices[].sshAlias] | length == (unique | length)) and
    ([.devices[] | select(.management.mode == "relay") | .management.relayPort] | length == (unique | length)) and
    ([.devices[] | select(.management.mode == "relay") | .management.relayUser] | length == (unique | length)) and
    (.bastion.sshAlias as $alias | all(.devices[]; .sshAlias != $alias))
  ' "$INVENTORY" >/dev/null || die "device ids, SSH aliases, relay ports and relay users must be unique"

  jq -e '
    .bastion as $b |
    [.devices[] | select(.id == $b.deviceId)] |
    length == 1 and
    .[0].management.mode == "direct" and
    .[0].management.host == $b.host and
    .[0].management.port == $b.port
  ' "$INVENTORY" >/dev/null || die "bastion device must exist as a matching direct-route device"
}

validate_public_key_archive() {
  local id expected actual key
  [ -d "$PUBLIC_KEY_DIR" ] || die "public-key archive is missing: $PUBLIC_KEY_DIR"
  require_command ssh-keygen

  for id in $(jq -r '.devices[].id' "$INVENTORY"); do
    key="$PUBLIC_KEY_DIR/$id.mesh.pub"
    [ -r "$key" ] || die "missing archived management public key: $key"
    expected="$(jq -r --arg id "$id" '.devices[] | select(.id == $id) | .access.keyFingerprint' "$INVENTORY")"
    actual="$(ssh-keygen -lf "$key" | awk '{print $2}')"
    [ "$actual" = "$expected" ] || die "management key fingerprint mismatch for $id: expected $expected, got $actual"
  done

  for id in $(jq -r '.devices[] | select(.management.mode == "relay") | .id' "$INVENTORY"); do
    key="$PUBLIC_KEY_DIR/$id.relay.pub"
    [ -r "$key" ] || die "missing archived relay public key: $key"
    expected="$(jq -r --arg id "$id" '.devices[] | select(.id == $id) | .management.relayKeyFingerprint' "$INVENTORY")"
    actual="$(ssh-keygen -lf "$key" | awk '{print $2}')"
    [ "$actual" = "$expected" ] || die "relay key fingerprint mismatch for $id: expected $expected, got $actual"
  done
}

resolve_device() {
  local selector="$1"
  local record
  record="$(jq -c --arg selector "$selector" '
    [.devices[] | select(.id == $selector or .sshAlias == $selector)] | first // empty
  ' "$INVENTORY")"
  [ -n "$record" ] || die "unknown device: $selector"
  printf '%s\n' "$record"
}

device_field() {
  local selector="$1"
  local field="$2"
  resolve_device "$selector" | jq -er "$field"
}

list_devices() {
  jq -r '
    ["ID", "SSH ALIAS", "ACCOUNT", "MODE", "ENDPOINT", "ROLE"],
    (.bastion.loopbackAddress as $loopback |
      .devices[] |
      [
        .id,
        .sshAlias,
        .account,
        .management.mode,
        (if .management.mode == "relay" then $loopback + ":" + (.management.relayPort | tostring) else .management.host + ":" + (.management.port | tostring) end),
        .role
      ]) |
    @tsv
  ' "$INVENTORY" | awk -F '\t' '
    NR == 1 { printf "%-16s %-20s %-12s %-8s %-22s %s\n", $1, $2, $3, $4, $5, $6; next }
    { printf "%-16s %-20s %-12s %-8s %-22s %s\n", $1, $2, $3, $4, $5, $6 }
  '
}

show_topology() {
  jq -r '
    .bastion as $b |
    "bastion=" + $b.deviceId + " alias=" + $b.sshAlias + " endpoint=" + $b.host + ":" + ($b.port | tostring) + " forward_user=" + $b.forwardUser,
    (.devices[] |
      if .management.mode == "relay" then
        "device=" + .id + " alias=" + .sshAlias + " route=relay relay_user=" + .management.relayUser + " cloud_endpoint=" + $b.loopbackAddress + ":" + (.management.relayPort | tostring)
      else
        "device=" + .id + " alias=" + .sshAlias + " route=direct endpoint=" + .management.host + ":" + (.management.port | tostring)
      end)
  ' "$INVENTORY"
}

show_credentials() {
  local selector="${1:-}"
  if [ -n "$selector" ]; then
    resolve_device "$selector" | jq '{id, account, access, credentialPaths: (.paths | with_entries(select(.key | test("[Cc]redential"))))}'
  else
    jq '[.devices[] | {id, account, access, credentialPaths: (.paths | with_entries(select(.key | test("[Cc]redential"))))}]' "$INVENTORY"
  fi
}

show_route() {
  local selector="$1"
  local alias
  alias="$(device_field "$selector" '.sshAlias')"
  ssh -G "$alias" 2>/dev/null | awk '
    $1 == "hostname" || $1 == "user" || $1 == "port" ||
    $1 == "proxyjump" || $1 == "hostkeyalias" || $1 == "identityfile" {
      if ($1 == "identityfile") $2 = "~/.ssh/<device-management-key>"
      print
    }
  '
}

probe_one() {
  local selector="$1"
  local record alias id
  record="$(resolve_device "$selector")"
  id="$(printf '%s' "$record" | jq -r '.id')"
  alias="$(printf '%s' "$record" | jq -r '.sshAlias')"
  printf '%-16s ' "$id"
  if output="$(ssh -n -o BatchMode=yes -o ConnectTimeout="$CONNECT_TIMEOUT" "$alias" 'printf "ok host=%s user=%s" "$(hostname)" "$(id -un)"' 2>&1)"; then
    printf '%s\n' "$output"
  else
    printf 'FAILED %s\n' "$output"
    return 1
  fi
}

probe_devices() {
  local selector="${1:-all}"
  local failed=0
  if [ "$selector" = "all" ]; then
    while IFS= read -r id; do
      probe_one "$id" || failed=1
    done < <(jq -r '.devices[].id' "$INVENTORY")
  else
    probe_one "$selector" || failed=1
  fi
  return "$failed"
}

verify_write_one() {
  local selector="$1"
  local record alias id
  record="$(resolve_device "$selector")"
  id="$(printf '%s' "$record" | jq -r '.id')"
  alias="$(printf '%s' "$record" | jq -r '.sshAlias')"
  printf '%-16s ' "$id"
  if output="$(ssh -n -o BatchMode=yes -o ConnectTimeout="$CONNECT_TIMEOUT" "$alias" '
    set -eu
    umask 077
    tmp="$(mktemp "${TMPDIR:-/tmp}/later-device-access.XXXXXX")"
    trap '\''rm -f "$tmp"'\'' EXIT HUP INT TERM
    printf '\''later-device-access-write-ok\n'\'' > "$tmp"
    [ "$(cat "$tmp")" = '\''later-device-access-write-ok'\'' ]
    rm -f "$tmp"
    trap - EXIT HUP INT TERM
    printf "ok host=%s user=%s temp_removed=yes" "$(hostname)" "$(id -un)"
  ' 2>&1)"; then
    printf '%s\n' "$output"
  else
    printf 'FAILED %s\n' "$output"
    return 1
  fi
}

verify_writes() {
  local selector="${1:-all}"
  local failed=0
  if [ "$selector" = "all" ]; then
    while IFS= read -r id; do
      verify_write_one "$id" || failed=1
    done < <(jq -r '.devices[].id' "$INVENTORY")
  else
    verify_write_one "$selector" || failed=1
  fi
  return "$failed"
}

live_facts() {
  local selector="$1"
  local alias id
  id="$(device_field "$selector" '.id')"
  alias="$(device_field "$selector" '.sshAlias')"
  echo "device_id=$id"
  ssh -o BatchMode=yes -o ConnectTimeout="$CONNECT_TIMEOUT" "$alias" 'bash -s' <<'REMOTE'
set -u
printf 'hostname='; hostname
printf 'account='; id -un
printf 'uid='; id -u
printf 'os='; if [ -r /etc/os-release ]; then . /etc/os-release; printf '%s\n' "$PRETTY_NAME"; elif command -v sw_vers >/dev/null 2>&1; then sw_vers -productName | tr -d '\n'; printf ' %s\n' "$(sw_vers -productVersion)"; else uname -s; fi
printf 'kernel='; uname -r
printf 'arch='; uname -m
printf 'addresses='; if command -v ip >/dev/null 2>&1; then ip -o -4 addr show scope global | awk '{print $2 "=" $4}' | paste -sd, -; else ifconfig | awk '/^[a-z0-9].*:/{gsub(":", "", $1); iface=$1} /inet / && $2 != "127.0.0.1" {printf "%s%s=%s", sep, iface, $2; sep=","} END{print ""}'; fi
printf 'default_route='; if command -v ip >/dev/null 2>&1; then ip route show default | head -1; else route -n get default 2>/dev/null | awk '/gateway:|interface:/{printf "%s%s=%s", sep, $1, $2; sep=","} END{print ""}'; fi
printf 'disk_root='; df -h / | awk 'NR==2 {print $3 "/" $2 " used=" $5}'
if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user list-unit-files later-device-relay.service --no-legend 2>/dev/null | grep -q '^later-device-relay.service'; then
    relay_state="$(systemctl --user is-active later-device-relay.service 2>/dev/null || true)"
    printf 'device_relay=%s\n' "${relay_state:-unknown}"
  else
    echo 'device_relay=not-installed'
  fi
  if systemctl list-unit-files pi-web.service --no-legend 2>/dev/null | grep -q '^pi-web.service'; then
    pi_state="$(systemctl is-active pi-web.service 2>/dev/null || true)"
    printf 'pi_web=%s\n' "${pi_state:-unknown}"
  else
    echo 'pi_web=not-installed'
  fi
  for gateway_service in nginx cloudflared; do
    if systemctl list-unit-files "$gateway_service.service" --no-legend 2>/dev/null | grep -q "^$gateway_service.service"; then
      gateway_state="$(systemctl is-active "$gateway_service.service" 2>/dev/null || true)"
      printf '%s=%s\n' "$gateway_service" "${gateway_state:-unknown}"
    fi
  done
else
  printf 'device_relay='; launchctl print "gui/$(id -u)/com.later.device-relay" >/dev/null 2>&1 && echo active || echo inactive
  printf 'pi_web='; launchctl print "gui/$(id -u)/com.later.pi-web.production" >/dev/null 2>&1 && echo active || echo inactive
fi
REMOTE
}

facts_devices() {
  local selector="${1:-all}"
  local failed=0
  local id
  if [ "$selector" = "all" ]; then
    for id in $(jq -r '.devices[].id' "$INVENTORY"); do
      echo "=== $id ==="
      live_facts "$id" || failed=1
    done
  else
    live_facts "$selector" || failed=1
  fi
  return "$failed"
}

audit_devices() {
  local selector="${1:-all}"
  local failed=0
  echo '=== inventory ==='
  validate_secret_boundary || failed=1
  echo '=== topology ==='
  show_topology
  echo '=== connectivity ==='
  probe_devices "$selector" || failed=1
  echo '=== live facts ==='
  facts_devices "$selector" || failed=1
  return "$failed"
}

validate_secret_boundary() {
  local bad_keys
  check_inventory_file
  bad_keys="$(jq -r '.. | objects | keys[]' "$INVENTORY" | grep -E '^(password|token|secret|privateKey|cookie|apiKey)$' || true)"
  [ -z "$bad_keys" ] || die "forbidden secret-bearing keys found: $(printf '%s' "$bad_keys" | paste -sd, -)"
  if grep -Eq -- '-----BEGIN .*PRIVATE KEY-----|(^|[^A-Za-z0-9])(ghp_|sk-[A-Za-z0-9])' "$INVENTORY"; then
    die "inventory appears to contain private-key or token material"
  fi
  validate_public_key_archive
  echo "OK: inventory schema v2, topology, uniqueness and secret boundary validated"
}

main() {
  check_inventory_file
  local command="${1:-}"
  case "$command" in
    list)
      [ "$#" -eq 1 ] || die "list takes no arguments"
      list_devices
      ;;
    show)
      [ "$#" -eq 2 ] || die "show requires one device"
      resolve_device "$2" | jq .
      ;;
    credentials)
      [ "$#" -le 2 ] || die "credentials accepts zero or one device"
      show_credentials "${2:-}"
      ;;
    topology)
      [ "$#" -eq 1 ] || die "topology takes no arguments"
      show_topology
      ;;
    route)
      [ "$#" -eq 2 ] || die "route requires one device"
      show_route "$2"
      ;;
    probe)
      [ "$#" -le 2 ] || die "probe accepts zero or one device/all"
      probe_devices "${2:-all}"
      ;;
    verify-write)
      [ "$#" -le 2 ] || die "verify-write accepts zero or one device/all"
      verify_writes "${2:-all}"
      ;;
    facts)
      [ "$#" -eq 2 ] || die "facts requires one device or all"
      facts_devices "$2"
      ;;
    audit)
      [ "$#" -le 2 ] || die "audit accepts zero or one device/all"
      audit_devices "${2:-all}"
      ;;
    run)
      [ "$#" -ge 4 ] || die "run requires: <device> -- <command>"
      [ "$3" = "--" ] || die "run requires -- before the remote command"
      alias="$(device_field "$2" '.sshAlias')"
      shift 3
      remote_command="$(build_remote_command "$@")"
      ssh "$alias" "$remote_command"
      ;;
    ssh)
      [ "$#" -eq 2 ] || die "ssh requires one device"
      alias="$(device_field "$2" '.sshAlias')"
      exec ssh "$alias"
      ;;
    check)
      [ "$#" -eq 1 ] || die "check takes no arguments"
      validate_secret_boundary
      ;;
    -h|--help|help|"")
      usage
      ;;
    *)
      usage >&2
      die "unknown command: $command"
      ;;
  esac
}

main "$@"
