#!/usr/bin/env bash
set -euo pipefail

# Manage the macOS LaunchAgents installed by install-mobile-relay.sh.

production_label="com.later.pi-web.production"
relay_label="com.later.pi-web.cloud-relay"
launch_domain="gui/$(id -u)"
launch_agents_dir="$HOME/Library/LaunchAgents"
production_plist="$launch_agents_dir/$production_label.plist"
relay_plist="$launch_agents_dir/$relay_label.plist"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log_dir="$project_root/deploy/logs"
health_url="http://127.0.0.1:30141/api/health"
cloud_host="121.43.113.236"
remote_port=33041
public_hostname="${PI_WEB_PUBLIC_HOSTNAME:-pi.ai4child.asia}"
ssh_target="root@$cloud_host"

usage() {
  cat <<EOF
用法: $0 <status|start|stop|restart|logs>

  status   查看本地服务、健康检查和云端隧道状态
  start    启动已安装的生产服务和云端隧道
  stop     停止生产服务和云端隧道（保留 plist）
  restart  重启生产服务和云端隧道
  logs     持续查看两个服务的日志（Ctrl-C 退出）

首次安装或更新部署请运行：
  ./scripts/install-mobile-relay.sh
EOF
}

is_loaded() {
  launchctl print "$launch_domain/$1" >/dev/null 2>&1
}

job_pid() {
  launchctl print "$launch_domain/$1" 2>/dev/null \
    | awk '/^[[:space:]]*pid = / { print $3; exit }'
}

is_running() {
  [[ -n "$(job_pid "$1")" ]]
}

print_job() {
  local label="$1"
  if is_loaded "$label"; then
    local pid
    pid="$(job_pid "$label")"
    if [[ -n "$pid" ]]; then
      printf '%-38s 运行中 (PID %s)\n' "$label" "$pid"
      return 0
    else
      printf '%-38s 已载入，正在等待/重试\n' "$label"
      return 1
    fi
  else
    printf '%-38s 未运行\n' "$label"
    return 1
  fi
}

remote_relay_healthy() {
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=yes \
    "$ssh_target" \
    "curl --fail --silent --max-time 3 http://127.0.0.1:$remote_port/api/health" \
    >/dev/null 2>&1
}

public_relay_healthy() {
  [[ -z "$public_hostname" || "$public_hostname" == "none" ]] && return 0
  /usr/bin/curl --noproxy "$public_hostname" \
    --fail --silent --connect-timeout 5 --max-time 8 \
    "https://$public_hostname/api/health" >/dev/null 2>&1
}

# A Mac sleep/network transition can leave the server-side sshd connection in
# CLOSE-WAIT. The loopback listener then exists but cannot forward requests,
# and every replacement tunnel fails with ExitOnForwardFailure. Port 33041 is
# dedicated to this service, so reclaim only an sshd-owned listener on it.
release_remote_relay_port() {
  echo "检查云端反向隧道端口……"
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "$ssh_target" \
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
        echo \"端口 \$port 被占用，但无法确定进程；拒绝自动清理。\" >&2
        exit 3
      fi
      comm=\$(ps -o comm= -p \"\$pid\" | tr -d '[:space:]')
      if test \"\$comm\" != sshd; then
        echo \"端口 \$port 由非 sshd 进程占用（PID \$pid）；拒绝自动清理。\" >&2
        exit 3
      fi
      echo \"回收旧 SSH 反向隧道（云端 PID \$pid）。\"
      kill \"\$pid\"
      for _attempt in 1 2 3 4 5; do
        if ! ss -ltnH \"sport = :\$port\" 2>/dev/null | grep -q .; then
          exit 0
        fi
        sleep 1
      done
      echo \"停止 PID \$pid 后端口 \$port 仍被占用。\" >&2
      exit 4
    "
}

status() {
  local errors=0
  print_job "$production_label" || errors=$((errors + 1))
  print_job "$relay_label" || errors=$((errors + 1))
  if /usr/bin/curl --fail --silent --max-time 3 "$health_url" >/dev/null 2>&1; then
    echo "本机健康检查                           正常 ($health_url)"
  else
    echo "本机健康检查                           失败 ($health_url)"
    errors=$((errors + 1))
  fi
  if remote_relay_healthy; then
    echo "云端隧道检查                           正常 (127.0.0.1:$remote_port)"
  else
    echo "云端隧道检查                           失败 (127.0.0.1:$remote_port)"
    errors=$((errors + 1))
  fi
  if [[ -n "$public_hostname" && "$public_hostname" != "none" ]]; then
    if public_relay_healthy; then
      echo "手机公网检查                           正常 (https://$public_hostname)"
    else
      echo "手机公网检查                           失败 (https://$public_hostname)"
      errors=$((errors + 1))
    fi
  fi
  [[ "$errors" -eq 0 ]]
}

require_plists() {
  if [[ ! -f "$production_plist" || ! -f "$relay_plist" ]]; then
    echo "LaunchAgent 尚未安装。请先运行：" >&2
    echo "  ./scripts/install-mobile-relay.sh" >&2
    exit 2
  fi
}

start_jobs() {
  require_plists
  if ! is_loaded "$production_label"; then
    launchctl bootstrap "$launch_domain" "$production_plist"
  fi
  launchctl kickstart -k "$launch_domain/$production_label"

  echo "等待 pi-web 就绪……"
  for _ in $(seq 1 30); do
    if /usr/bin/curl --fail --silent --max-time 2 "$health_url" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! /usr/bin/curl --fail --silent --max-time 2 "$health_url" >/dev/null 2>&1; then
    echo "pi-web 在 30 秒内未就绪，请运行 $0 logs 查看日志。" >&2
    exit 1
  fi

  # Stop the current client before claiming the dedicated remote port. If its
  # server-side sshd half survived, release_remote_relay_port removes it.
  launchctl bootout "$launch_domain/$relay_label" 2>/dev/null || true
  release_remote_relay_port
  launchctl bootstrap "$launch_domain" "$relay_plist"

  echo "等待云端反向隧道就绪……"
  for _ in $(seq 1 20); do
    if is_running "$relay_label" && remote_relay_healthy; then
      if [[ -n "$public_hostname" && "$public_hostname" != "none" ]]; then
        echo "等待手机公网入口就绪……"
        for _public_attempt in 1 2 3 4; do
          public_relay_healthy && break
          sleep 2
        done
      fi
      status
      return
    fi
    sleep 1
  done
  echo "云端反向隧道在 20 秒内未就绪，请运行 $0 logs 查看日志。" >&2
  status || true
  exit 1
}

stop_jobs() {
  launchctl bootout "$launch_domain/$relay_label" 2>/dev/null || true
  launchctl bootout "$launch_domain/$production_label" 2>/dev/null || true
  # Best effort: a half-closed server-side sshd must not block the next start.
  release_remote_relay_port || echo "警告：未能确认云端隧道端口已释放。" >&2
  echo "生产服务和云端隧道已停止。"
}

show_logs() {
  mkdir -p "$log_dir"
  touch "$log_dir/pi-web.stdout.log" "$log_dir/pi-web.stderr.log" \
    "$log_dir/cloud-relay.stdout.log" "$log_dir/cloud-relay.stderr.log"
  tail -n 100 -F \
    "$log_dir/pi-web.stdout.log" \
    "$log_dir/pi-web.stderr.log" \
    "$log_dir/cloud-relay.stdout.log" \
    "$log_dir/cloud-relay.stderr.log"
}

case "${1:-}" in
  status) status ;;
  start) start_jobs ;;
  stop) stop_jobs ;;
  restart) stop_jobs; start_jobs ;;
  logs) show_logs ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
