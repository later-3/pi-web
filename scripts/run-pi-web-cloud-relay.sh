#!/usr/bin/env bash

set -euo pipefail

cloud_host="121.43.113.236"
remote_port="33041"
local_port="30141"

usage() {
  echo "Usage: $0 [--cloud-host HOST] [--remote-port PORT] [--local-port PORT]" >&2
  exit 2
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --cloud-host) [[ "$#" -ge 2 ]] || usage; cloud_host="$2"; shift 2 ;;
    --remote-port) [[ "$#" -ge 2 ]] || usage; remote_port="$2"; shift 2 ;;
    --local-port) [[ "$#" -ge 2 ]] || usage; local_port="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

[[ "$cloud_host" =~ ^[A-Za-z0-9.-]+$ ]] || usage
[[ "$remote_port" =~ ^[0-9]+$ && "$remote_port" -ge 1 && "$remote_port" -le 65535 ]] || usage
[[ "$local_port" =~ ^[0-9]+$ && "$local_port" -ge 1 && "$local_port" -le 65535 ]] || usage

ssh_options=(
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o StrictHostKeyChecking=yes
)
ssh_target="root@$cloud_host"

# Do not claim a cloud listener that would only forward to a dead local app.
/usr/bin/curl --fail --silent --max-time 3 \
  "http://127.0.0.1:$local_port/api/health" >/dev/null

# A network transition can leave the cloud-side sshd child holding the
# dedicated reverse listener after the client has died. A raw launchd ssh job
# then retries forever with "remote port forwarding failed". Before every
# connection attempt, retain a listener that still forwards successfully; if
# it no longer forwards, reclaim only an sshd-owned listener on this dedicated
# port. Never stop an unknown owner.
set +e
/usr/bin/ssh "${ssh_options[@]}" "$ssh_target" "
  set -eu
  port=$remote_port
  for attempt in 1 2 3; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:\$port/api/health >/dev/null 2>&1; then
      exit 10
    fi
    sleep 1
  done
  if ! ss -ltnH \"sport = :\$port\" 2>/dev/null | grep -q .; then
    exit 0
  fi
  pid=\$(ss -ltnp \"sport = :\$port\" 2>/dev/null | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p' | head -n 1)
  test -n \"\$pid\" || { echo \"relay port \$port owner is unknown\" >&2; exit 3; }
  comm=\$(ps -o comm= -p \"\$pid\" | tr -d '[:space:]')
  test \"\$comm\" = sshd || { echo \"relay port \$port owner is not sshd\" >&2; exit 3; }
  kill \"\$pid\"
  for attempt in 1 2 3 4 5; do
    if ! ss -ltnH \"sport = :\$port\" 2>/dev/null | grep -q .; then
      exit 0
    fi
    sleep 1
  done
  exit 4
"
preflight_status="$?"
set -e

if [[ "$preflight_status" -eq 10 ]]; then
  # Another still-functional connection owns the dedicated listener. Avoid
  # disrupting it; KeepAlive will run this preflight again after the pause.
  sleep 30
  exit 0
fi
[[ "$preflight_status" -eq 0 ]] || exit "$preflight_status"

exec /usr/bin/ssh -NT \
  "${ssh_options[@]}" \
  -o ConnectionAttempts=3 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o TCPKeepAlive=yes \
  -R "127.0.0.1:$remote_port:127.0.0.1:$local_port" \
  "$ssh_target"
