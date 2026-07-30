#!/usr/bin/env bash
set -euo pipefail

# Install pi-web production LaunchAgent + SSH reverse-tunnel LaunchAgent.
#
# This script:
#   1. Builds the mobile production bundle (.next-mobile) if not already built.
#   2. Generates a random login password and an independent cookie-signing key.
#   3. Installs the Nginx config on the server (no browser-native Basic Auth).
#   4. Configures Pi Web to authenticate with a signed HttpOnly cookie.
#   5. Installs two LaunchAgents on this Mac:
#      - com.later.pi-web.production  (next start on .next-mobile)
#      - com.later.pi-web.cloud-relay (ssh -NT -R 33041:30141)
#
# Existing user data, sessions, and the dev server (.next) are never touched.

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cloud_host="121.43.113.236"
local_port=30141
remote_port=33041
nginx_port=33042
public_hostname="${PI_WEB_PUBLIC_HOSTNAME:-pi.ai4child.asia}"
device_id="${PI_WEB_DEVICE_ID:-mac-main}"
device_name="${PI_WEB_DEVICE_NAME:-Main Mac}"
device_public_url="${PI_WEB_PUBLIC_URL:-https://$public_hostname}"
devices_file="${PI_WEB_DEVICES_FILE:-$project_root/deploy/devices.local.json}"
user_name="$(id -un)"
user_id="$(id -u)"
user_home="$(/usr/bin/dscl . -read "/Users/$user_name" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
launch_agents_dir="$user_home/Library/LaunchAgents"
launch_domain="gui/$user_id"
production_label="com.later.pi-web.production"
relay_label="com.later.pi-web.cloud-relay"
secrets_dir="$project_root/deploy/secrets"
log_dir="$project_root/deploy/logs"
state_dir="$project_root/deploy/state"
password_file="$secrets_dir/pi-web-http-password"
credentials_file="$secrets_dir/pi-web-auth-credentials.json"
session_secret_file="$secrets_dir/pi-web-session-secret"
production_plist="$launch_agents_dir/$production_label.plist"
relay_plist="$launch_agents_dir/$relay_label.plist"

usage() {
  cat >&2 <<EOF
usage: $0 [--skip-build] [--skip-server]

Options:
  --skip-build     Skip the production build step (use existing .next-mobile).
  --skip-server    Skip updating server-side Nginx (the SSH relay still starts).
EOF
}

skip_build=false
skip_server=false

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --skip-build)    skip_build=true; shift ;;
    --skip-server)   skip_server=true; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               echo "unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

# --- Preflight checks -------------------------------------------------------

node_bin="$(command -v node)"
if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo "node binary not found in PATH" >&2
  exit 2
fi
node_dir="$(dirname "$node_bin")"
next_bin="$project_root/node_modules/.bin/next"
if [[ ! -x "$next_bin" ]]; then
  echo "next binary not found: $next_bin (run npm install first)" >&2
  exit 2
fi

# --- Step 1: Build -----------------------------------------------------------

if [[ "$skip_build" != "true" ]]; then
  echo "==> Building mobile production bundle (.next-mobile)..."
  cd "$project_root"
  PI_WEB_DIST_DIR=.next-mobile "$next_bin" build --webpack
  echo "    Build complete."
else
  if [[ ! -s "$project_root/.next-mobile/BUILD_ID" ]]; then
    echo ".next-mobile/BUILD_ID does not exist; run without --skip-build first" >&2
    exit 2
  fi
  echo "==> Skipping build (--skip-build)."
fi

# --- Step 2: Generate authentication secrets ---------------------------------

mkdir -p "$secrets_dir" "$log_dir" "$state_dir"
chmod 700 "$secrets_dir" "$log_dir" "$state_dir"

if [[ ! -s "$password_file" ]]; then
  # Hex avoids a pipe/head SIGPIPE under `set -o pipefail` and is safe to pass
  # through the bounded verification command below.
  openssl rand -hex 18 > "$password_file"
  chmod 600 "$password_file"
  echo "==> Generated random password: $password_file"
else
  echo "==> Using existing password: $password_file"
fi

if [[ ! -s "$credentials_file" ]]; then
  password="$(<"$password_file")"
  printf '{"credentials":[{"username":"piweb","password":"%s"}]}\n' "$password" > "$credentials_file"
  chmod 600 "$credentials_file"
  echo "==> Created credentials file from the existing piweb account: $credentials_file"
else
  echo "==> Using existing credentials file: $credentials_file"
fi

if [[ ! -s "$session_secret_file" ]]; then
  openssl rand -hex 32 > "$session_secret_file"
  chmod 600 "$session_secret_file"
  echo "==> Generated session signing key: $session_secret_file"
else
  echo "==> Using existing session signing key: $session_secret_file"
fi

# Stop only our exact managed jobs. Afterwards any remaining listener is an
# unmanaged dev/production process and must be handled explicitly; otherwise
# the readiness probe could accidentally validate the wrong Next.js process.
launchctl bootout "$launch_domain/$relay_label" 2>/dev/null || true
launchctl bootout "$launch_domain/$production_label" 2>/dev/null || true

if lsof -nP -iTCP:"$local_port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
  echo "port $local_port is already in use; stop the existing pi-web/dev process and rerun with --skip-build" >&2
  exit 3
fi

echo "==> Checking SSH connectivity to root@$cloud_host..."
if ! /usr/bin/ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  -o StrictHostKeyChecking=yes \
  "root@$cloud_host" true; then
  echo "passwordless SSH or the pinned host key is unavailable for root@$cloud_host" >&2
  exit 3
fi

# A dead client connection can leave sshd holding the dedicated reverse-tunnel
# listener in CLOSE-WAIT. Reclaim only an sshd-owned listener on port 33041;
# never kill an unrelated process that happens to use a configured port.
echo "==> Checking remote reverse-tunnel port $remote_port..."
/usr/bin/ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  -o StrictHostKeyChecking=yes \
  "root@$cloud_host" \
  "
    set -eu
    port=$remote_port
    for _attempt in 1 2 3; do
      if ! ss -ltnH \"sport = :\$port\" 2>/dev/null | grep -q .; then
        exit 0
      fi
      sleep 1
    done
    pid=\$(ss -ltnp \"sport = :\$port\" 2>/dev/null | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p' | head -n 1)
    if test -z \"\$pid\"; then
      echo \"remote port \$port is occupied, but its owner cannot be identified\" >&2
      exit 3
    fi
    comm=\$(ps -o comm= -p \"\$pid\" | tr -d '[:space:]')
    if test \"\$comm\" != sshd; then
      echo \"remote port \$port belongs to non-sshd PID \$pid; refusing to stop it\" >&2
      exit 3
    fi
    echo \"    Reclaiming stale SSH relay (remote PID \$pid).\"
    kill \"\$pid\"
    for _attempt in 1 2 3 4 5; do
      if ! ss -ltnH \"sport = :\$port\" 2>/dev/null | grep -q .; then
        exit 0
      fi
      sleep 1
    done
    echo \"remote port \$port is still occupied after stopping PID \$pid\" >&2
    exit 4
  "

# --- Step 3: Server-side Nginx installation ----------------------------------

if [[ "$skip_server" != "true" ]]; then

  release_id="$(date -u +%Y%m%dT%H%M%SZ)"

  # Upload the cookie-auth-compatible Nginx config. Login secrets never leave
  # this Mac; the public server only forwards HTTPS traffic.
  /usr/bin/scp -o StrictHostKeyChecking=yes \
    "$project_root/deploy/nginx/pi-web.conf" \
    "root@$cloud_host:/tmp/pi-web-nginx-$release_id.conf"

  # Upload and run the server-side install script.
  /usr/bin/scp -o StrictHostKeyChecking=yes \
    "$project_root/deploy/server/install-pi-web-relay.sh" \
    "root@$cloud_host:/tmp/install-pi-web-relay.sh"
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "chmod +x /tmp/install-pi-web-relay.sh && /tmp/install-pi-web-relay.sh $release_id"

  echo "    Server Nginx configured."
else
  echo "==> Skipping server installation (--skip-server)."
fi

# --- Step 4: Install LaunchAgents -------------------------------------------

echo "==> Installing LaunchAgents..."

escape_sed() {
  printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

escaped_project_root="$(escape_sed "$project_root")"
escaped_log_dir="$(escape_sed "$log_dir")"
escaped_user_home="$(escape_sed "$user_home")"
escaped_node_bin="$(escape_sed "$node_bin")"
escaped_node_dir="$(escape_sed "$node_dir")"
escaped_next_bin="$(escape_sed "$next_bin")"
escaped_credentials_file="$(escape_sed "$credentials_file")"
escaped_session_secret_file="$(escape_sed "$session_secret_file")"
escaped_public_hostname="$(escape_sed "$public_hostname")"

# Production plist.
sed \
  -e "s|__PROJECT_ROOT__|$escaped_project_root|g" \
  -e "s|__LOG_DIR__|$escaped_log_dir|g" \
  -e "s|__USER_HOME__|$escaped_user_home|g" \
  -e "s|__NODE_BIN__|$escaped_node_bin|g" \
  -e "s|__NODE_DIR__|$escaped_node_dir|g" \
  -e "s|__NEXT_BIN__|$escaped_next_bin|g" \
  -e "s|__AUTH_CREDENTIALS_FILE__|$escaped_credentials_file|g" \
  -e "s|__AUTH_SESSION_SECRET_FILE__|$escaped_session_secret_file|g" \
  -e "s|__PUBLIC_HOSTNAME__|$escaped_public_hostname|g" \
  "$project_root/deploy/macos/com.later.pi-web.production.plist.in" > "$production_plist"

# plutil writes user-provided values without requiring fragile XML/sed escaping.
# A missing devices file is intentionally non-fatal: Pi Web keeps the current
# device available and hides the switcher until a valid directory is added.
/usr/bin/plutil -insert EnvironmentVariables.PI_WEB_DEVICE_ID \
  -string "$device_id" "$production_plist"
/usr/bin/plutil -insert EnvironmentVariables.PI_WEB_DEVICE_NAME \
  -string "$device_name" "$production_plist"
/usr/bin/plutil -insert EnvironmentVariables.PI_WEB_PUBLIC_URL \
  -string "$device_public_url" "$production_plist"
/usr/bin/plutil -insert EnvironmentVariables.PI_WEB_DEVICES_FILE \
  -string "$devices_file" "$production_plist"

# Relay plist.
sed \
  -e "s|__LOG_DIR__|$escaped_log_dir|g" \
  "$project_root/deploy/macos/com.later.pi-web.cloud-relay.plist.in" > "$relay_plist"

chmod 600 "$production_plist" "$relay_plist"
/usr/bin/plutil -lint "$production_plist" >/dev/null
/usr/bin/plutil -lint "$relay_plist" >/dev/null

# Start production server first, wait for readiness.
launchctl bootstrap "$launch_domain" "$production_plist"

echo "    Waiting for pi-web production server..."
ready=false
for _attempt in $(seq 1 30); do
  if /usr/bin/curl --fail --silent "http://127.0.0.1:$local_port/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "pi-web production server did not become ready; check $log_dir/pi-web.stderr.log" >&2
  exit 4
fi
echo "    Production server ready."

# Start the SSH relay.
launchctl bootstrap "$launch_domain" "$relay_plist"

echo "    Waiting for SSH reverse tunnel..."
relay_ready=false
for _attempt in $(seq 1 20); do
  if /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "curl --fail --silent --max-time 3 http://127.0.0.1:$remote_port/api/health >/dev/null 2>&1"; then
    relay_ready=true
    break
  fi
  sleep 1
done
if [[ "$relay_ready" != "true" ]]; then
  echo "SSH reverse tunnel did not become ready; check $log_dir/cloud-relay.stderr.log" >&2
  exit 4
fi
echo "    SSH reverse tunnel ready."

# --- Step 5: Save state ------------------------------------------------------

{
  printf 'cloud_host=%s\n' "$cloud_host"
  printf 'local_port=%s\n' "$local_port"
  printf 'remote_port=%s\n' "$remote_port"
  printf 'nginx_port=%s\n' "$nginx_port"
  printf 'installed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$state_dir/mobile-relay.env"
chmod 600 "$state_dir/mobile-relay.env"

echo ""
echo "=== pi-web mobile relay installed ==="
echo "Local:        http://127.0.0.1:$local_port"
echo "Cloud relay:  http://127.0.0.1:$remote_port (on $cloud_host)"
echo "Nginx:        http://127.0.0.1:$nginx_port (on $cloud_host)"
echo "Public:       https://$public_hostname (after Cloudflare setup)"
echo "Accounts:     $credentials_file"
echo "Legacy pass:  $password_file"
echo "Session key:  $session_secret_file"
echo "Logs:         $log_dir/"
