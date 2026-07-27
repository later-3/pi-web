#!/usr/bin/env bash
set -euo pipefail

# Runs as root on the cloud server (121.43.113.236).
# The caller uploads staging files before invoking this script:
#   /tmp/pi-web-nginx-<release>.conf
#   /tmp/pi-web-htpasswd-<release>

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
staged_htpasswd="/tmp/pi-web-htpasswd-$release_id"
nginx_site="/etc/nginx/sites-available/pi-web.conf"
htpasswd="/etc/nginx/pi-web.htpasswd"
backup_dir="/var/backups/pi-web/$release_id"

for staged_file in "$staged_conf" "$staged_htpasswd"; do
  if [[ ! -s "$staged_file" ]]; then
    echo "missing or empty staging file: $staged_file" >&2
    exit 2
  fi
done

mkdir -p /var/backups/pi-web "$backup_dir"

# Backup existing files if they exist.
if [[ -f "$nginx_site" ]]; then
  install -m 0600 "$nginx_site" "$backup_dir/nginx-site.before"
fi
if [[ -f "$htpasswd" ]]; then
  install -m 0600 "$htpasswd" "$backup_dir/htpasswd.before"
fi

rollback() {
  if [[ -f "$backup_dir/nginx-site.before" ]]; then
    install -m 0644 "$backup_dir/nginx-site.before" "$nginx_site"
  else
    rm -f "$nginx_site"
  fi
  if [[ -f "$backup_dir/htpasswd.before" ]]; then
    install -o root -g www-data -m 0640 "$backup_dir/htpasswd.before" "$htpasswd"
  else
    rm -f "$htpasswd"
  fi
  # If nginx was already running with the old config, try to reload back.
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
}

trap 'rollback' ERR

# Install the nginx site config.
install -o root -g root -m 0644 "$staged_conf" "$nginx_site"

# Install the htpasswd file (www-data group so nginx workers can read it).
install -o root -g www-data -m 0640 "$staged_htpasswd" "$htpasswd"

# Enable the site if not already symlinked.
if [[ ! -L /etc/nginx/sites-enabled/pi-web.conf ]]; then
  ln -sf "$nginx_site" /etc/nginx/sites-enabled/pi-web.conf
fi

# Test before reload — this is the critical safety gate.
nginx -t

# Reload only after successful test.
systemctl reload nginx

trap - ERR
rm -f "$staged_conf" "$staged_htpasswd"

echo "pi_web_release=$release_id"
echo "pi_web_nginx=$nginx_site"
echo "pi_web_htpasswd=$htpasswd"
