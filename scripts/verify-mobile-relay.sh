#!/usr/bin/env bash
set -euo pipefail

# Verify pi-web mobile relay installation.
#
# Checks:
#   1. Local health endpoint responds.
#   2. LaunchAgents are loaded.
#   3. Nginx exposes the app login page without WWW-Authenticate.
#   4. Protected pages redirect to /login without an app cookie.
#   5. App credentials create a cookie that unlocks protected pages.
#   6. (Optional) Public hostname verification.

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cloud_host="121.43.113.236"
local_port=30141
remote_port=33041
nginx_port=33042
public_hostname="${PI_WEB_PUBLIC_HOSTNAME:-pi.ai4child.asia}"
password_file="$project_root/deploy/secrets/pi-web-http-password"
credentials_file="$project_root/deploy/secrets/pi-web-auth-credentials.json"
node_bin="$(command -v node)"
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

launchagent_running() {
  launchctl print "gui/$user_id/$1" 2>/dev/null \
    | grep -Eq '^[[:space:]]*pid = [0-9]+'
}

verify_cloud_cookie_login() {
  local payload="$1"
  printf '%s' "$payload" | /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "headers=\$(curl --silent --max-time 8 --dump-header - --output /dev/null \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      http://127.0.0.1:$nginx_port/api/auth/session) && \
     cookie=\$(printf '%s' \"\$headers\" | tr -d '\r' | sed -n 's/^Set-Cookie: \(pi-web-session=[^;]*\).*/\1/p' | head -n 1) && \
     if test -z \"\$cookie\"; then \
       cookie=\$(printf '%s' \"\$headers\" | tr -d '\r' | sed -n 's/^set-cookie: \(pi-web-session=[^;]*\).*/\1/p' | head -n 1); \
     fi && \
     test -n \"\$cookie\" && \
     curl --fail --silent --max-time 8 --header \"Cookie: \$cookie\" http://127.0.0.1:$nginx_port/"
}

verify_public_cookie_login() {
  local payload="$1"
  local cookie_jar
  cookie_jar="$(mktemp)"
  if printf '%s' "$payload" | /usr/bin/curl --noproxy "$public_hostname" \
    --fail --silent \
    --connect-timeout 5 \
    --max-time 15 \
    --header "Content-Type: application/json" \
    --data-binary @- \
    --cookie-jar "$cookie_jar" \
    "https://$public_hostname/api/auth/session" >/dev/null \
    && /usr/bin/curl --noproxy "$public_hostname" \
      --fail --silent --connect-timeout 5 --max-time 15 \
      --cookie "$cookie_jar" "https://$public_hostname/" >/dev/null; then
    rm -f "$cookie_jar"
    return 0
  fi
  rm -f "$cookie_jar"
  return 1
}

credential_usernames() {
  "$node_bin" -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const entries = Array.isArray(data) ? data : data.credentials;
    if (!Array.isArray(entries) || entries.length === 0) process.exit(2);
    for (const entry of entries) {
      if (typeof entry.username !== "string" || !entry.username) process.exit(2);
      process.stdout.write(`${entry.username}\n`);
    }
  ' "$credentials_file"
}

login_payload_for() {
  "$node_bin" -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const entries = Array.isArray(data) ? data : data.credentials;
    const credential = entries.find((entry) => entry.username === process.argv[2]);
    if (!credential) process.exit(2);
    process.stdout.write(JSON.stringify({ ...credential, persistent: true }));
  ' "$credentials_file" "$1"
}

echo "=== pi-web mobile relay verification ==="
echo ""

# --- Local checks -----------------------------------------------------------

echo "[local]"
check "health endpoint responds" \
  /usr/bin/curl --fail --silent --show-error --max-time 5 \
    "http://127.0.0.1:$local_port/api/health"

check "production LaunchAgent running" launchagent_running "$production_label"

check "cloud-relay LaunchAgent running" launchagent_running "$relay_label"

echo ""

# --- Cloud loopback checks --------------------------------------------------

echo "[cloud loopback]"

check "SSH tunnel alive (remote health via relay)" \
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "curl --fail --silent --max-time 5 http://127.0.0.1:$remote_port/api/health"

# Health stays public for relay readiness.
status_health="$(
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:$nginx_port/api/health" \
    2>/dev/null || true
)"
status_health="${status_health:-000}"
if [[ "$status_health" == "200" ]]; then
  echo "  ✓ Nginx health is reachable without browser auth"
else
  echo "  ✗ Nginx health returned $status_health (expected 200)"
  errors=$((errors + 1))
fi

# Protected navigation should redirect to the app-owned login page.
status_root="$(
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:$nginx_port/" \
    2>/dev/null || true
)"
status_root="${status_root:-000}"
if [[ "$status_root" =~ ^30[2378]$ ]]; then
  echo "  ✓ Protected root redirects to the app login"
else
  echo "  ✗ Protected root returned $status_root without a cookie (expected redirect)"
  errors=$((errors + 1))
fi

check "login page is reachable without WWW-Authenticate" \
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "root@$cloud_host" \
    "headers=\$(curl --silent --max-time 5 --dump-header - --output /dev/null http://127.0.0.1:$nginx_port/login); \
     printf '%s' \"\$headers\" | head -n 1 | grep -q ' 200 ' && \
     ! printf '%s' \"\$headers\" | tr -d '\r' | grep -qi '^WWW-Authenticate:'"

if [[ -s "$credentials_file" ]]; then
  while IFS= read -r account; do
    if login_payload="$(login_payload_for "$account")"; then
      check "$account app login cookie unlocks the protected root" verify_cloud_cookie_login "$login_payload"
    else
      echo "  ✗ $account account not found in credentials file"
      errors=$((errors + 1))
    fi
  done < <(credential_usernames)
elif [[ -s "$password_file" ]]; then
  password="$(<"$password_file")"
  login_payload="$(printf '{\"username\":\"piweb\",\"password\":\"%s\",\"persistent\":true}' "$password")"
  check "legacy piweb app login cookie unlocks the protected root" verify_cloud_cookie_login "$login_payload"
else
  echo "  ⚠ credentials file not found; skipping app login check"
fi

echo ""

# --- Optional public hostname check -----------------------------------------

if [[ -n "$public_hostname" && "$public_hostname" != "none" ]]; then
  echo "[public: $public_hostname]"
  if [[ -s "$credentials_file" ]]; then
    check "public login page is reachable" \
      /usr/bin/curl --noproxy "$public_hostname" \
        --fail --silent --connect-timeout 5 --max-time 15 \
        "https://$public_hostname/login"
    while IFS= read -r account; do
      if login_payload="$(login_payload_for "$account")"; then
        check "$account public app login cookie unlocks the root" verify_public_cookie_login "$login_payload"
      else
        echo "  ✗ $account account not found in credentials file"
        errors=$((errors + 1))
      fi
    done < <(credential_usernames)
  elif [[ -s "$password_file" ]]; then
    password="$(<"$password_file")"
    login_payload="$(printf '{\"username\":\"piweb\",\"password\":\"%s\",\"persistent\":true}' "$password")"
    check "public login page is reachable" \
      /usr/bin/curl --noproxy "$public_hostname" \
        --fail --silent --connect-timeout 5 --max-time 15 \
        "https://$public_hostname/login"
    check "legacy piweb public app login cookie unlocks the root" verify_public_cookie_login "$login_payload"
  else
    echo "  ⚠ credentials file not found; skipping public login check"
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
