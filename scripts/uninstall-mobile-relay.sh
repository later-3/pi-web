#!/usr/bin/env bash
set -euo pipefail

# Uninstall pi-web production + cloud-relay LaunchAgents.
#
# This script:
#   - Stops and removes ONLY the two exact LaunchAgent labels.
#   - Removes the plist files from ~/Library/LaunchAgents/.
#   - Preserves all user data, sessions, logs, build artifacts, and secrets.
#   - Does NOT kill arbitrary processes.

user_name="$(id -un)"
user_id="$(id -u)"
user_home="$(/usr/bin/dscl . -read "/Users/$user_name" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
launch_agents_dir="$user_home/Library/LaunchAgents"
launch_domain="gui/$user_id"

production_label="com.later.pi-web.production"
relay_label="com.later.pi-web.cloud-relay"

echo "==> Stopping LaunchAgents..."
launchctl bootout "$launch_domain/$relay_label" 2>/dev/null || true
launchctl bootout "$launch_domain/$production_label" 2>/dev/null || true

echo "==> Removing plist files..."
rm -f \
  "$launch_agents_dir/$production_label.plist" \
  "$launch_agents_dir/$relay_label.plist"

echo ""
echo "=== pi-web mobile relay uninstalled ==="
echo "LaunchAgents removed. The following were preserved:"
echo "  - Session data (~/.pi/agent/sessions/)"
echo "  - Build artifacts (.next-mobile/)"
echo "  - Logs (deploy/logs/)"
echo "  - Secrets (deploy/secrets/)"
echo "  - Dev server (.next/) — unaffected"
echo ""
echo "To also remove server-side Nginx config, SSH into the cloud server and:"
echo "  rm -f /etc/nginx/sites-enabled/pi-web.conf"
echo "  rm -f /etc/nginx/sites-available/pi-web.conf"
echo "  rm -f /etc/nginx/pi-web.htpasswd"
echo "  nginx -t && systemctl reload nginx"
