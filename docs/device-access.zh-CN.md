# Later 多设备访问、配置与环境归档

> 状态：已部署并验证（2026-07-31）
> 适用设备：`mac-main`、`linux-home`、`cloud-relay` 及后续加入 inventory 的设备
> 唯一事实源：[`ops/device-inventory.json`](../ops/device-inventory.json)
> 新增/下线/轮换设备：[`device-onboarding.zh-CN.md`](./device-onboarding.zh-CN.md)

## 1. 快速结论

这套能力同时服务于两种使用方式：

1. **人在 Terminal 操作**：直接运行 `later-device ...`、`ssh later-pop` 等命令。
2. **人在 Pi Web / Pi Agent 对话**：用自然语言描述目标，Agent 根据 `AGENTS.md` 调用同一批命令。

它不是 Pi 的斜杠命令或插件。底层是 inventory 驱动的 OpenSSH 控制层；Pi 只是按项目指令安全地调用它。

最常用的 8 条命令：

```bash
later-device list
later-device topology
later-device facts linux-home
later-device probe all
later-device audit all
later-device run linux-home -- hostname
ssh later-pop
ssh later-cloud-admin
```

如果 `later-device` 不在 PATH：

```bash
# Mac 仓库内
./scripts/device-access.sh list

# Pop!_OS 独立运行副本
/home/later/.local/share/later-device-access/scripts/device-access.sh list
```

## 2. 问题、目标与非目标

### 2.1 目标

1. Mac、Pop!_OS、云服务器及未来设备不在同一 LAN 时仍可双向访问和配置。
2. 新设备接入只增加 1 条出站 relay，不建立 N×N 网络隧道。
3. 账号、IP、路径、角色、公钥指纹和约束可版本化；秘密不进入 Git。
4. Terminal、Pi Web、Pi Agent 和开发人员使用同一套设备 id、命令和验收标准。
5. 新增、下线、密钥轮换和故障排查有可重复、可回滚流程。

### 2.2 非目标

- 不同步设备间的项目、Session、Provider Key 或系统密码。
- 不把云端 relay 端口公开到互联网。
- 不让云端受限转发账号获得 Shell。
- 不把当前小规模公钥分发方案伪装成无限扩展的企业 PKI；达到规模阈值后应迁移 SSH CA。

## 3. 架构与工作原理

### 3.1 数据路径

```text
Mac (mac-main) ── outbound SSH -R 33101 ──┐
                                          │
                                          ▼
                                   Cloud bastion
                               121.43.113.236:22
                               loopback listeners
                                127.0.0.1:33101
                                127.0.0.1:33102
                                          ▲
                                          │
Pop!_OS (linux-home) ─ outbound SSH -R 33102 ┘

访问 A → B：
  A 的 later-device / ssh
    → later-bastion（只允许指定 permitopen）
    → Cloud loopback:<B relay port>
    → B:sshd
    → B authorized_keys 验证 A 的管理公钥
```

每台 relay 设备只维护 1 条到云端的出站连接，因此网络接入复杂度是 O(N)。NAT、动态公网 IP 和是否同一局域网都不影响入口。

### 3.2 两层认证

一次跨设备 SSH 有两次独立认证：

1. **来源设备 → `later-mesh`**：云端只允许转发到 inventory 派生的 `127.0.0.1:<relayPort>`。
2. **来源设备 → 最终目标账号**：使用来源设备自己的 `id_ed25519_later_mesh`；云端不能替代目标做授权决定。

relay 服务另用 `id_ed25519_later_relay`，只允许创建本设备对应的 `permitlisten`。管理 key 与 relay key 分离，泄露一个不会自动获得另一类权限。

### 3.3 复杂度边界

- 隧道数量：O(N)，每个 relay 设备 1 条。
- 当前目标 `authorized_keys` 中的管理公钥总量：O(N²)，因为任意来源需要登录任意目标。
- 建议阈值：设备达到 **6 台**、人员达到 **3 人**，或需要短期授权/集中吊销时，迁移 OpenSSH CA、Tailscale SSH 或等价证书体系；不要继续手工复制大量永久公钥。

Tailscale 可作为低延迟直连层，但当前云 relay 是不依赖第三方登录的稳定兜底。引入 overlay 时应保留相同设备 id 和 SSH alias，避免上层命令变化。

## 4. Inventory：唯一事实源

实际清单：[`ops/device-inventory.json`](../ops/device-inventory.json)
机器可读契约：[`ops/device-inventory.schema.json`](../ops/device-inventory.schema.json)

### 4.1 顶层字段

| 字段 | 作用 |
|---|---|
| `schemaVersion` | 当前固定为 `2` |
| `updatedAt` | 最后一次事实审计日期 |
| `policy` | 秘密边界和路由策略 |
| `defaults` | 管理 key、连接超时、HostKeyAlias 前缀 |
| `bastion` | 云端设备 id、地址、转发账号和 loopback 地址 |
| `devices[]` | 每台设备的身份、路由、账号、地址、路径和约束 |

### 4.2 `management.mode`

`relay` 设备：

```json
{
  "mode": "relay",
  "relayPort": 33103,
  "relayUser": "later-relay-linux-lab",
  "service": "systemd --user later-device-relay.service"
}
```

`direct` 设备：

```json
{
  "mode": "direct",
  "host": "203.0.113.10",
  "port": 22
}
```

SSH 配置和云端 `permitopen/permitlisten` 必须从 inventory 生成，不能在多个模板里手工重复维护。修改后依次运行：

```bash
later-device check
./scripts/render-device-ssh-config.sh --output deploy/device-access/ssh-config
./scripts/test-device-access.sh
```

### 4.3 归档与秘密边界

可以进入 Git：设备 id、账号名、IP/DNS、动态属性、路径、角色、端口、公钥指纹、秘密管理器条目引用和安全约束。

禁止进入 Git、聊天、命令参数和日志：系统密码、私钥、Token、Cookie、Provider Key、OAuth 凭据、Pi Web 登录原文和会话签名密钥。

当前状态：Mac/Pop 交互式 sudo 密码未提供且远程 SSH 不依赖它们；云端已关闭 password 与 keyboard-interactive SSH。Pi Web 凭据文件在两台设备上均为 `600`。

## 5. 命令参考

所有查询命令默认只读；只有 `verify-write`、`run` 中的写命令和交互式 `ssh` 可能修改目标。

| 命令 | 是否修改 | 说明 |
|---|---:|---|
| `later-device list` | 否 | 列出 id、alias、账号、路由模式和端点 |
| `later-device show <id>` | 否 | 输出单台归档 JSON |
| `later-device credentials [id]` | 否 | 只显示认证状态、指纹和引用，不读取秘密 |
| `later-device topology` | 否 | 显示 bastion、relay 用户和派生端点 |
| `later-device route <id>` | 否 | 显示 OpenSSH 最终解析结果，隐藏真实 key 路径 |
| `later-device probe [id\|all]` | 否 | 验证 SSH、目标主机名和目标账号 |
| `later-device facts <id\|all>` | 否 | 查询 OS、网络、磁盘和相关服务 |
| `later-device audit [id\|all]` | 否 | 一次执行 inventory、topology、probe、facts |
| `later-device verify-write [id\|all]` | 是，可逆 | 创建 `600` 临时文件、校验后删除 |
| `later-device run <id> -- <cmd>` | 取决于命令 | 在单台设备执行非交互命令 |
| `later-device ssh <id>` | 取决于人工操作 | 打开交互式 Shell |
| `later-device check` | 否 | 校验 schema v2、唯一性、拓扑和秘密边界 |

设备选择器既可用 id，也可用 alias：

```bash
later-device facts linux-home
later-device facts later-pop
```

成功返回 `0`；校验、连接或任一目标失败返回非 `0`，适合自动化检查。

## 6. Terminal 使用示例

### 6.1 查看与检查

```bash
# 设备总表和派生拓扑
later-device list
later-device topology

# 单设备归档、路由和实时事实
later-device show linux-home
later-device route linux-home
later-device facts linux-home

# 所有设备连通与只读审计
later-device probe all
later-device facts all
later-device audit all

# 查看认证状态但不读取密码/私钥
later-device credentials
```

### 6.2 执行单条命令

```bash
later-device run linux-home -- hostname
later-device run mac-main -- uname -a
later-device run cloud-relay -- systemctl is-active nginx cloudflared
later-device run linux-home -- systemctl --user status later-device-relay.service --no-pager
```

`--` 之前是设备选择，之后是远端命令。包含管道、重定向或变量时，显式交给远端 Shell：

```bash
later-device run linux-home -- bash -lc 'df -h / && systemctl is-active pi-web'
```

不要把密码或 Token 放进命令参数；它们可能进入 Shell history、进程列表或日志。

### 6.3 交互式 SSH

```bash
ssh later-pop
ssh later-mac
ssh later-cloud-admin

# 等价的 inventory id 形式
later-device ssh linux-home
```

退出远端 Shell：

```bash
exit
```

`later-cloud-admin` 是云端管理员入口。删除、SSH daemon、防火墙、账号和 Nginx 修改必须先备份并写出回滚命令。

### 6.4 文件传输

```bash
scp local-file later-pop:/home/later/
scp later-mac:/Users/xulater/report.txt ./
rsync -av --progress -e ssh local-dir/ later-pop:/home/later/target/
```

大文件通过云 relay 会多一跳；低延迟或大批量同步应评估 overlay/direct route，不要把文件同步塞进 Pi Web Session 层。

## 7. Pi Web / Pi Agent 对话示例

工作区级和项目级 `AGENTS.md` 已告诉 Agent 先定位、再操作。推荐直接说目标和约束，而不是只贴一个裸 `ssh` 命令。

### 7.1 只读检查 Pop!_OS

```text
检查 linux-home 的实时系统、磁盘、网络、Pi Web 和 device relay 状态。
只读，不做修改；先运行 facts 和 probe，最后汇总异常。
```

### 7.2 从 Pop!_OS 检查 Mac

```text
访问 mac-main，检查 Pi Web production、管理 relay 和磁盘空间。
不要重启服务，不要修改文件。
```

### 7.3 配置目标设备

```text
在 linux-home 修改 <具体配置>。
先读取现状并备份原文件，说明影响范围；修改后执行配置校验和服务健康检查，最后给出回滚命令。
```

### 7.4 检查全部设备

```text
对所有归档设备执行只读多设备审计：检查 inventory、拓扑、SSH 连通、实时事实和 relay 服务。
任何一台失败都不要改配置，按“来源设备→bastion→目标 relay→目标 sshd”分层定位。
```

### 7.5 云端高风险操作

```text
检查 cloud-relay 的 SSH、Nginx、cloudflared 和 33101/33102 监听。
只读；确认 relay 端口仅绑定 127.0.0.1，不修改安全组、防火墙或 sshd。
```

Agent 应优先使用 `facts`、`probe`、`audit` 和 `run`。只有需要连续交互时才启动 `ssh`；不要让一个无人看管的交互 Shell 长时间挂起。

## 8. 文件、组件与所有权

| 文件 | 责任 |
|---|---|
| `ops/device-inventory.json` | 实际设备唯一事实源 |
| `ops/device-inventory.schema.json` | inventory v2 机器可读契约 |
| `ops/device-public-keys/` | 可版本化的 management/relay 公钥；`check` 核对 inventory 指纹 |
| `scripts/device-access.sh` | 人和 Agent 的统一 CLI |
| `scripts/render-device-ssh-config.sh` | 从 inventory 确定性生成 SSH Host blocks |
| `scripts/install-device-client.sh` | 安装来源设备的管理 key、SSH 配置和命令入口 |
| `scripts/install-device-relay.sh` | 为 relay 设备安装持久出站隧道 |
| `deploy/device-access/install-cloud.sh` | inventory 驱动的云端受限账号和白名单 |
| `scripts/authorize-device-key.sh` | 在最终目标追加来源管理公钥 |
| `scripts/pin-device-host-key.sh` | 在可信通道取得后固定目标 host key |
| `scripts/test-device-access.sh` | 无网络、无 root 的离线扩容与失败关闭测试 |
| `deploy/device-access/ssh-config` | renderer 的审计快照，不直接手改 |
| `deploy/device-access/*service*` | macOS/Linux relay 服务模板 |
| `deploy/device-access/workspace-AGENTS.md` | 跨项目 Agent 指令模板 |

安装后的运行位置：

- Mac：`~/.ssh/config.d/later-devices.conf`、`~/Library/LaunchAgents/com.later.device-relay.plist`。
- Pop!_OS：`~/.ssh/config.d/later-devices.conf`、`~/.config/systemd/user/later-device-relay.service`。
- 云端：`later-mesh`、各 `later-relay-*` 系统账号及 loopback listeners。

## 9. 安全与信任边界

1. relay 端口只能绑定 `127.0.0.1`；公网测试必须失败。
2. `later-mesh` 使用 `restrict,port-forwarding,permitopen=...`，没有 Shell、PTY、agent/X11 forwarding。
3. 每个 `later-relay-*` 账号只能 `permitlisten` 自己的 inventory 端口。
4. `ForwardAgent no`；不把来源设备的 SSH agent 暴露给云端或目标。
5. relay 目标用稳定 `HostKeyAlias later-device-<id>` 严格校验；禁止盲目 `StrictHostKeyChecking=no/accept-new`。
6. 云端当前为公钥登录：`PasswordAuthentication no`、`KbdInteractiveAuthentication no`、`PermitRootLogin prohibit-password`。
7. 云端安装脚本只管理自己标记的目标公钥块，保留其他管理员 key；专用 forward/relay 账号的 key 文件由脚本完整管理。
8. 配置变更遵循“先读 → 备份 → 最小修改 → 校验 → 健康检查 → 回滚说明”。

端口表：

| 位置 | 端口 | 绑定 | 用途 |
|---|---:|---|---|
| Cloud | `22` | 公网 | SSH 管理与所有出站 relay 入口 |
| Cloud | `33101` | `127.0.0.1` | `mac-main:sshd` |
| Cloud | `33102` | `127.0.0.1` | `linux-home:sshd` |
| Cloud | `33041/33043` | `127.0.0.1` | 现有 Pi Web HTTP relay，与本控制层独立 |

## 10. 日常检查和故障定位

### 10.1 推荐日检

```bash
later-device check
later-device probe all
later-device facts all
```

需要完整证据时：

```bash
later-device audit all
```

`verify-write all` 会产生短暂写入，只在部署验收、权限变更或故障恢复后运行，不属于普通只读日检。

### 10.2 分层定位

```text
命令不存在
  → PATH / later-device symlink / runtime bundle

SSH alias 不存在
  → inventory check / renderer / ~/.ssh/config Include

later-bastion 认证失败
  → 来源 mesh key / 云端 later-mesh authorized_keys / cloud host key

stdio forwarding failed
  → permitopen 未包含目标 relay port，或目标 listener 未恢复

目标 connection refused/timeout
  → 目标 relay service / 云端 loopback listener / 目标 sshd

Host key verification failed
  → 禁止绕过；通过可信 LAN/现有认证连接重新取得目标 host public key并审核指纹

最终 Permission denied
  → 目标 authorized_keys 缺少来源 mesh 公钥，或目标账号不匹配
```

检查命令：

```bash
later-device topology
later-device route linux-home
ssh -G later-pop

# 云端 listener（只读）
later-device run cloud-relay -- ss -ltn 'sport = :33101 or sport = :33102'

# Pop relay
later-device run linux-home -- systemctl --user status later-device-relay.service --no-pager
```

### 10.3 不要这样修

- 不要把 `33101/33102` 改成 `0.0.0.0`。
- 不要关闭 host key 校验。
- 不要给 `later-mesh` 或 relay 账号交互 Shell。
- 不要用共享私钥解决公钥分发问题。
- 不要因单次 SSH 失败重装 Pi Web；两套 relay 相互独立。

## 11. 部署、扩容、下线和回滚

完整流程见 [新增、下线与密钥轮换手册](./device-onboarding.zh-CN.md)。核心顺序固定为：

```text
只读探测
  → 分配 id/alias/relay port
  → 修改 inventory
  → check + render + offline tests
  → 生成独立 mesh/relay keys
  → cloud --plan
  → 更新 cloud 白名单
  → 分发目标授权与 host keys
  → 安装 client/relay
  → N×N probe + write test
  → 更新 PROJECT_STATE + 提交
```

回滚管理 relay 不影响 Pi Web `33041/33043`、Session 或项目。服务级回滚：

```bash
# Mac
launchctl bootout "gui/$(id -u)/com.later.device-relay"

# Linux
systemctl --user disable --now later-device-relay.service
```

配置备份位于 `~/.local/state/later-device-access/backups/<UTC timestamp>/`。下线设备时先撤销云端和所有目标的授权，再停止目标 relay，最后删除 inventory；不能只从 UI/文档删一行。

## 12. 测试与交付门槛

离线测试：

```bash
./scripts/test-device-access.sh
```

当前覆盖 14 项：Shell 语法、生产 inventory、renderer 快照、第三台设备扩容、重复端口拒绝、指纹不匹配拒绝、秘密内容拒绝、授权幂等、撤销备份、HostKeyAlias 固定、云端动态 plan、缺 key 失败关闭、远端参数边界、交接文档相对链接。

真实部署最低验收：

1. `later-device check` 成功。
2. 每个来源对每个目标执行 `probe`；N 台设备应有 N×N 条成功路径。
3. 每个来源执行一次 `verify-write all`，随后确认临时文件已删除。
4. 重启新增 relay 服务后 listener 和连接自动恢复。
5. 公网不能连接新增 relay port；`later-mesh` Shell 和白名单外转发失败。
6. 如目标运行 Pi Web，再执行对应 health、登录、SSE 和既有 relay 回归。
7. `git diff --check`、秘密扫描和文档链接核对通过。

2026-07-31 初始部署证据：3 个来源 × 3 个目标 `9/9` 登录、`9/9` 临时写入/校验/删除；双 relay 重启恢复；公网端口、Shell、越权转发负向测试通过；Pi Web 完整 relay 验证通过。

## 13. 已知风险和后续路线

1. 云服务器 host firewall 当前 inactive，仍依赖云安全组；启用前先确认云控制台应急入口。
2. Mac 防火墙当前关闭；变更时回归本机 SSH、Pi Web 和 LaunchAgent。
3. 云 relay 多一跳，适合控制命令和中小文件；大文件或低延迟工作可引入 overlay direct route。
4. 达到规模阈值后迁移 SSH CA/短期证书，减少 O(N²) 永久公钥分发。
5. 系统交互密码应进入用户自己的密码管理器，inventory 只保存引用；当前引用为空不能被误报为“已备份密码”。
