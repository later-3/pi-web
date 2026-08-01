#!/usr/bin/env bash

# Read-only, end-to-end Pi Web cloud/mobile diagnosis.
#
# This script intentionally checks both application backends. The older
# verify-mobile-relay.sh performs authenticated Mac/control-plane acceptance;
# this command answers the operational question "which layer is down?" without
# reading or printing Pi Web credentials.

set -uo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
device_access="${LATER_DEVICE_COMMAND:-$project_root/scripts/device-access.sh}"
public_hostname="${PI_WEB_PUBLIC_HOSTNAME:-pi.ai4child.asia}"
check_public=1
checks=0
errors=0
warnings=0

usage() {
  cat <<EOF
用法: $0 [--no-public] [--hostname <域名>]

只读检查 Pi Web 手机链路的 5 层状态：
  1. Mac production 与 HTTP relay
  2. Pop!_OS production、systemd 归属与 HTTP relay
  3. 云端 nginx/cloudflared、配置与 loopback 监听
  4. 云端 33041/33042/33043/33044 健康接口
  5. 公网默认、Mac、Linux 和未知设备 Cookie 路由

选项:
  --no-public       跳过公网 DNS/TLS/Cloudflare 检查
  --hostname NAME   覆盖公网域名（默认: ${public_hostname}）
  -h, --help        显示帮助

脚本不会重启服务、修改配置、读取登录密码或打印 Cookie。
详细说明: docs/pi-web-cloud-operations.zh-CN.md
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --no-public)
      check_public=0
      shift
      ;;
    --hostname)
      if [[ "$#" -lt 2 || -z "$2" ]]; then
        echo "错误：--hostname 需要一个域名。" >&2
        exit 2
      fi
      public_hostname="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "错误：未知参数 $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

pass() {
  checks=$((checks + 1))
  printf '  ✓ %s\n' "$1"
}

fail() {
  checks=$((checks + 1))
  errors=$((errors + 1))
  printf '  ✗ %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf '  ! %s\n' "$1"
}

info() {
  printf '  · %s\n' "$1"
}

render_snapshot() {
  local snapshot="$1"
  local line kind message

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    kind="${line%%|*}"
    if [[ "$line" == *"|"* ]]; then
      message="${line#*|}"
    else
      kind="INFO"
      message="$line"
    fi

    case "$kind" in
      PASS) pass "$message" ;;
      FAIL) fail "$message" ;;
      WARN) warn "$message" ;;
      INFO) info "$message" ;;
      *) info "$line" ;;
    esac
  done <<< "$snapshot"
}

run_remote_snapshot() {
  local title="$1"
  local device="$2"
  local remote_script="$3"
  local snapshot status

  echo "[$title]"
  snapshot="$(printf '%s\n' "$remote_script" | "$device_access" run "$device" -- bash -s 2>&1)"
  status=$?
  if [[ "$status" -ne 0 ]]; then
    fail "无法通过 device-access 读取 ${device}（退出码 ${status}）"
    if [[ -n "$snapshot" ]]; then
      info "远端错误: $(printf '%s\n' "$snapshot" | tail -n 1)"
    fi
  else
    render_snapshot "$snapshot"
  fi
  echo ""
}

if [[ ! -x "$device_access" ]]; then
  echo "错误：找不到可执行的 device-access: $device_access" >&2
  exit 2
fi

for command_name in curl awk tail; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "错误：缺少命令 $command_name" >&2
    exit 2
  fi
done

read -r -d '' mac_script <<'REMOTE' || true
set -uo pipefail

uid="$(id -u)"
production_label="com.later.pi-web.production"
relay_label="com.later.pi-web.cloud-relay"

job_pid() {
  launchctl print "gui/$uid/$1" 2>/dev/null \
    | awk '/^[[:space:]]*pid = [0-9]+/ { print $3; exit }'
}

production_pid="$(job_pid "$production_label")"
relay_pid="$(job_pid "$relay_label")"

if [[ "$production_pid" =~ ^[0-9]+$ ]]; then
  echo "PASS|Mac production LaunchAgent 运行中（PID ${production_pid}）"
else
  echo "FAIL|Mac production LaunchAgent 未运行"
fi

if [[ "$relay_pid" =~ ^[0-9]+$ ]]; then
  echo "PASS|Mac Pi Web relay LaunchAgent 运行中（PID ${relay_pid}）"
else
  echo "FAIL|Mac Pi Web relay LaunchAgent 未运行"
fi

health_code="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 5 http://127.0.0.1:30141/api/health 2>/dev/null || true)"
if [[ "$health_code" == "200" ]]; then
  echo "PASS|Mac 127.0.0.1:30141 health=200"
else
  echo "FAIL|Mac 127.0.0.1:30141 health=${health_code:-000}"
fi

listener="$(lsof -nP -iTCP:30141 -sTCP:LISTEN 2>/dev/null | tail -n +2)"
if [[ -n "$listener" ]] && printf '%s\n' "$listener" | grep -q '127\.0\.0\.1:30141'; then
  echo "PASS|Mac 30141 仅见 loopback 监听"
else
  echo "FAIL|Mac 30141 未见预期的 127.0.0.1 监听"
fi

if [[ "$relay_pid" =~ ^[0-9]+$ ]]; then
  relay_started="$(ps -o lstart= -p "$relay_pid" 2>/dev/null | awk '{$1=$1; print}')"
  relay_state="$(launchctl print "gui/$uid/$relay_label" 2>/dev/null || true)"
  relay_runs="$(printf '%s\n' "$relay_state" | awk '/^[[:space:]]*runs = / { print $3; exit }')"
  last_exit="$(printf '%s\n' "$relay_state" | awk '/^[[:space:]]*last exit code = / { print $5; exit }')"
  echo "INFO|Mac relay 启动时间=${relay_started:-unknown}，launchd runs=${relay_runs:-unknown}，last_exit=${last_exit:-none}"
fi

relay_log="$(launchctl print "gui/$uid/$relay_label" 2>/dev/null \
  | sed -n 's/^[[:space:]]*stderr path = //p' | head -n 1)"
if [[ -r "$relay_log" ]]; then
  unreachable_count="$(tail -n 200 "$relay_log" | awk '/Network is unreachable/ { count++ } END { print count + 0 }')"
  if [[ "$unreachable_count" -gt 0 ]]; then
    echo "INFO|Mac relay 日志末 200 行含 $unreachable_count 次 Network is unreachable（历史信息，不单独判失败）"
  fi
fi
REMOTE

read -r -d '' linux_script <<'REMOTE' || true
set -uo pipefail

for service in pi-web pi-web-cloud-relay nginx; do
  state="$(systemctl is-active "$service" 2>/dev/null || true)"
  if [[ "$state" == "active" ]]; then
    echo "PASS|Linux $service.service=active"
  else
    echo "FAIL|Linux $service.service=${state:-unknown}"
  fi
done

health_code="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 5 http://127.0.0.1:30141/api/health 2>/dev/null || true)"
if [[ "$health_code" == "200" ]]; then
  echo "PASS|Linux 127.0.0.1:30141 health=200"
else
  echo "FAIL|Linux 127.0.0.1:30141 health=${health_code:-000}"
fi

listener="$(ss -H -ltnp 'sport = :30141' 2>/dev/null || true)"
if [[ -n "$listener" ]] \
  && printf '%s\n' "$listener" | awk '$4 != "127.0.0.1:30141" { bad=1 } END { exit bad }'; then
  echo "PASS|Linux 30141 仅绑定 127.0.0.1"
else
  echo "FAIL|Linux 30141 缺少预期 loopback 监听或绑定范围过宽"
fi

main_pid="$(systemctl show pi-web -p MainPID --value 2>/dev/null || true)"
listener_pid="$(printf '%s\n' "$listener" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)"
if [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] \
  && [[ "$listener_pid" == "$main_pid" ]] \
  && grep -q '/system.slice/pi-web.service' "/proc/$main_pid/cgroup" 2>/dev/null; then
  echo "PASS|Linux systemd MainPID、30141 listener 与 pi-web.service cgroup 一致（PID ${main_pid}）"
else
  echo "FAIL|Linux 进程归属异常（MainPID=${main_pid:-none}, listener=${listener_pid:-none}）"
fi
REMOTE

read -r -d '' cloud_script <<'REMOTE' || true
set -uo pipefail

for service in nginx cloudflared; do
  state="$(systemctl is-active "$service" 2>/dev/null || true)"
  restarts="$(systemctl show "$service" -p NRestarts --value 2>/dev/null || true)"
  active_since="$(systemctl show "$service" -p ActiveEnterTimestamp --value 2>/dev/null || true)"
  if [[ "$state" == "active" ]]; then
    echo "PASS|Cloud $service.service=active（NRestarts=${restarts:-unknown}）"
  else
    echo "FAIL|Cloud $service.service=${state:-unknown}（NRestarts=${restarts:-unknown}）"
  fi
  echo "INFO|Cloud $service active_since=${active_since:-unknown}"
done

if nginx -t >/dev/null 2>&1; then
  echo "PASS|Cloud nginx -t 配置校验通过"
else
  echo "FAIL|Cloud nginx -t 配置校验失败"
fi

for spec in '33041:sshd:Mac HTTP relay' '33042:nginx:同源主网关' '33043:sshd:Linux HTTP relay' '33044:nginx:Linux 直连网关'; do
  port="${spec%%:*}"
  remainder="${spec#*:}"
  owner="${remainder%%:*}"
  label="${remainder#*:}"
  listener="$(ss -H -ltnp "sport = :$port" 2>/dev/null || true)"
  if [[ -n "$listener" ]] \
    && printf '%s\n' "$listener" | awk -v endpoint="127.0.0.1:$port" '$4 != endpoint { bad=1 } END { exit bad }' \
    && printf '%s\n' "$listener" | grep -q "$owner"; then
    echo "PASS|Cloud $port $label 仅绑定 loopback，owner=$owner"
  else
    echo "FAIL|Cloud $port $label listener 缺失、owner 不符或绑定范围过宽"
  fi
done

for spec in '33041:Mac relay' '33043:Linux relay' '33044:Linux 直连网关'; do
  port="${spec%%:*}"
  label="${spec#*:}"
  health_code="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 5 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
  if [[ "$health_code" == "200" ]]; then
    echo "PASS|Cloud $port $label health=200"
  else
    echo "FAIL|Cloud $port $label health=${health_code:-000}"
  fi
done

control_code="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 5 \
  --header 'Host: pi.ai4child.asia' http://127.0.0.1:33042/login 2>/dev/null || true)"
if [[ "$control_code" == "200" ]]; then
  echo "PASS|Cloud 33042 控制面 /login=200（至少一台兼容设备在线）"
else
  echo "FAIL|Cloud 33042 控制面 /login=${control_code:-000}"
fi

if [[ -r /var/log/nginx/error.log ]]; then
  summary="$(tail -n 5000 /var/log/nginx/error.log | awk '
    /server: pi.ai4child.asia/ && /127.0.0.1:33041/ { mac++; mac_last=$1 " " $2 }
    /server: pi.ai4child.asia/ && /127.0.0.1:33043/ { linux++; linux_last=$1 " " $2 }
    END {
      printf "Cloud nginx error.log 末 5000 行：Mac upstream_failures=%d last=%s；Linux upstream_failures=%d last=%s",
        mac + 0, (mac_last ? mac_last : "none"), linux + 0, (linux_last ? linux_last : "none")
    }
  ')"
  echo "INFO|$summary"
fi

warning_count="$(journalctl -u cloudflared --since '24 hours ago' --no-pager -p warning..alert 2>/dev/null \
  | awk 'NF && $0 != "-- No entries --" { count++ } END { print count + 0 }')"
echo "INFO|Cloud cloudflared 最近 24 小时 warning..alert=${warning_count:-unknown}"
REMOTE

echo "=== Pi Web 云端/手机链路只读检查 ==="
echo "时间: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "入口: https://$public_hostname"
echo ""

if "$device_access" check >/dev/null 2>&1; then
  pass "device inventory、路由与公钥指纹校验通过"
else
  fail "device inventory、路由或公钥指纹校验失败"
fi
echo ""

run_remote_snapshot "Mac 后端" "mac-main" "$mac_script"
run_remote_snapshot "Linux 后端" "linux-home" "$linux_script"
run_remote_snapshot "云端网关" "cloud-relay" "$cloud_script"

probe_public_backend() {
  local cookie_value="$1"
  local expected_backend="$2"
  local label="$3"
  local headers status backend backend_state curl_status

  headers="$(curl --noproxy "$public_hostname" \
    --silent --show-error --connect-timeout 5 --max-time 15 \
    --header "Cookie: pi_web_device=$cookie_value" \
    --dump-header - --output /dev/null \
    "https://$public_hostname/api/health" 2>&1)"
  curl_status=$?
  if [[ "$curl_status" -ne 0 ]]; then
    fail "${label} 公网请求失败（curl=${curl_status}）"
    return
  fi

  status="$(printf '%s\n' "$headers" | awk '/^HTTP\// { code=$2 } END { print code }')"
  backend="$(printf '%s\n' "$headers" | awk 'tolower($1) == "x-pi-web-device:" { gsub("\\r", "", $2); value=$2 } END { print value }')"
  backend_state="$(printf '%s\n' "$headers" | awk 'tolower($1) == "x-pi-web-device-status:" { gsub("\\r", "", $2); value=$2 } END { print value }')"
  if [[ "$status" == "200" && "$backend" == "$expected_backend" ]]; then
    pass "${label} status=200，device=${backend}，state=${backend_state:-online}"
  elif [[ "$status" == "503" && "$backend" == "$expected_backend" && "$backend_state" == "offline" ]]; then
    pass "${label} 将离线设备转换为结构化 503（device=${backend}，state=offline）"
    warn "${label} 当前离线；入口和设备选择仍应可用"
  else
    fail "${label} status=${status:-000}，device=${backend:-missing}，state=${backend_state:-missing}（期望 ${expected_backend}）"
  fi
}

if [[ "$check_public" -eq 1 ]]; then
  echo "[公网 Cloudflare/TLS/粘性路由]"
  login_status="$(curl --noproxy "$public_hostname" \
    --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 5 --max-time 15 \
    "https://$public_hostname/login" 2>/dev/null || true)"
  if [[ "$login_status" == "200" ]]; then
    pass "公网 /login status=200（DNS、TLS、Cloudflare 与故障转移控制面可达）"
  else
    fail "公网 /login status=${login_status:-000}"
  fi

  probe_public_backend "" "mac-main" "默认设备路由"
  probe_public_backend "mac-main" "mac-main" "Mac Cookie 路由"
  probe_public_backend "linux-home" "linux-home" "Linux Cookie 路由"
  probe_public_backend "unknown" "mac-main" "未知 Cookie 安全回退"
  echo ""
else
  warn "已按 --no-public 跳过公网检查"
  echo ""
fi

echo "=== 汇总：$checks 项检查，$errors 项失败，$warnings 项警告 ==="
if [[ "$errors" -eq 0 ]]; then
  if [[ "$warnings" -eq 0 ]]; then
    echo "结论：当前全链路健康。历史错误只作定位依据，不代表现在仍故障。"
  else
    echo "结论：入口可用，但至少一台设备离线；结构化离线与切换控制面正常。"
  fi
  exit 0
fi

echo "结论：存在设备或链路故障；若公网控制面通过且离线设备返回结构化 503，入口仍可用。按第一个失败层处理，不要直接重启全部服务。"
exit 1
