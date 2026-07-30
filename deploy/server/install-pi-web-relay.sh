#!/usr/bin/env bash
set -euo pipefail

# Runs as root on the cloud server (121.43.113.236).
# The caller uploads staging files before invoking this script:
#   /tmp/pi-web-nginx-<release>.conf

if [[ "$#" -ne 1 ]]; then
  echo "usage: install-pi-web-relay.sh <release-id>" >&2
  exit 2
fi

release_id="$1"

if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "invalid release id: $release_id (expected YYYYMMDDTHHMMSSZ)" >&2
  exit 2
fi

staged_conf="/tmp/pi-web-nginx-$release_id.conf"
nginx_site="/etc/nginx/sites-available/pi-web.conf"
backup_dir="/var/backups/pi-web/$release_id"

if [[ ! -s "$staged_conf" ]]; then
  echo "missing or empty staging file: $staged_conf" >&2
  exit 2
fi

mkdir -p /var/backups/pi-web "$backup_dir"

# Backup existing files if they exist.
if [[ -f "$nginx_site" ]]; then
  install -m 0600 "$nginx_site" "$backup_dir/nginx-site.before"
fi

rollback() {
  if [[ -f "$backup_dir/nginx-site.before" ]]; then
    install -m 0644 "$backup_dir/nginx-site.before" "$nginx_site"
  else
    rm -f "$nginx_site"
  fi
  # If nginx was already running with the old config, try to reload back.
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
}

trap 'rollback' ERR

# Install the nginx site config.
install -o root -g root -m 0644 "$staged_conf" "$nginx_site"

# Enable the site if not already symlinked.
if [[ ! -L /etc/nginx/sites-enabled/pi-web.conf ]]; then
  ln -sf "$nginx_site" /etc/nginx/sites-enabled/pi-web.conf
fi

# Test before reload — this is the critical safety gate.
nginx -t

# Reload only after successful test.
systemctl reload nginx

trap - ERR
rm -f "$staged_conf"

echo "pi_web_release=$release_id"
echo "pi_web_nginx=$nginx_site"
