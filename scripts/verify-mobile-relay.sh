#!/usr/bin/env bash
set -euo pipefail

# Verify pi-web mobile relay installation.
#
# Checks:
#   1. Local health endpoint responds.
#   2. LaunchAgents are loaded.
#   3. Cloud loopback Nginx returns 401 without credentials.
#   4. Cloud loopback Nginx returns 200 with credentials.
#   5. (Optional) Public hostname verification.

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cloud_host="121.43.113.236"
local_port=30141
remote_port=33041
nginx_port=33042
public_hostname="${PI_WEB_PUBLIC_HOSTNAME:-pi.ai4child.asia}"
password_file="$project_root/deploy/secrets/pi-web-http-password"
user_id="$(id -u)"
production_label="com.later.pi-web.production"
relay_label="com.later.pi-web.cloud-relay"

errors=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ✓ $desc"
  else
    echo "  ✗ $desc"
    errors=$((errors + 1))
  fi
}

echo "=== pi-web mobile relay verification ==="
echo ""

# --- Local checks -----------------------------------------------------------

echo "[local]"
check "health endpoint responds" \
  /usr/bin/curl --fail --silent --show-error "http://127.0.0.1:$local_port/api/health"

check "production LaunchAgent loaded" \
  launchctl print "gui/$user_id/$production_label"

check "cloud-relay LaunchAgent loaded" \
  launchctl print "gui/$user_id/$relay_label"

echo ""

# --- Cloud loopback checks --------------------------------------------------

echo "[cloud loopback]"

check "SSH tunnel alive (remote health via relay)" \
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "curl --fail --silent http://127.0.0.1:$remote_port/api/health"

# Nginx without auth should return 401.
status_no_auth="$(
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:$nginx_port/api/health" \
    2>/dev/null || echo "000"
)"
if [[ "$status_no_auth" == "401" ]]; then
  echo "  ✓ Nginx returns 401 without credentials"
else
  echo "  ✗ Nginx returns $status_no_auth without credentials (expected 401)"
  errors=$((errors + 1))
fi

# Nginx with auth should return 200.
if [[ -s "$password_file" ]]; then
  password="$(<"$password_file")"
  check "Nginx returns 200 with Basic Auth" \
    /usr/bin/ssh \
      -o BatchMode=yes \
      -o ConnectTimeout=10 \
      -o StrictHostKeyChecking=yes \
      "root@$cloud_host" \
      "curl --fail --silent --user piweb:$password http://127.0.0.1:$nginx_port/api/health"
else
  echo "  ⚠ password file not found; skipping authenticated Nginx check"
fi

echo ""

# --- Optional public hostname check -----------------------------------------

if [[ -n "$public_hostname" && "$public_hostname" != "none" ]]; then
  echo "[public: $public_hostname]"
  if [[ -s "$password_file" ]]; then
    password="$(<"$password_file")"
    check "public health with Basic Auth" \
      /usr/bin/curl --fail --silent --user "piweb:$password" \
        "https://$public_hostname/api/health"
  else
    echo "  ⚠ password file not found; skipping public check"
  fi
  echo ""
fi

# --- Summary ----------------------------------------------------------------

if [[ "$errors" -eq 0 ]]; then
  echo "=== All checks passed ==="
  exit 0
else
  echo "=== $errors check(s) failed ==="
  exit 1
fi
